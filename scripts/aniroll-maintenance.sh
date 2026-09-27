#!/usr/bin/env bash
#
# AniRoll maintenance switch — runs ON THE SERVER (installed as /usr/local/bin/aniroll-maintenance).
#
#   aniroll-maintenance on ["reason"]   background syncing off in every browser
#   aniroll-maintenance off             back to normal
#   aniroll-maintenance status          current state
#   aniroll-maintenance offline         take the whole site down
#   aniroll-maintenance online          bring the site back up
#
# "on" keeps the site usable but stops every automatic AniList request in every open
# browser and on every device: watch party sync, member polling, the Jellyfin pull and
# the retry queue. Use it to let an AniList rate limit recover. Clients notice within
# a minute, a reload picks it up at once.
#
# "offline" is the hard version: the nginx site is removed and the API container stopped,
# so nothing is reachable. Other sites on this server are untouched.
#
# Needs root (docker, nginx, /opt/aniroll-api).

set -euo pipefail

DATA=/opt/aniroll-api/data
MAINT="$DATA/maintenance.json"
SITE=/etc/nginx/sites-enabled/aniroll
SITE_OFF=/root/aniroll-site-offline
SECRET=/root/aniroll-jf.secret
URL="${ANIROLL_URL:-https://aniroll.app}"

usage() {
    sed -n '3,20p' "$0" | sed 's/^# \{0,1\}//'
}

require_root() {
    if [ "$(id -u)" -ne 0 ]; then
        echo "This needs root (docker, nginx, /opt/aniroll-api)." >&2
        exit 1
    fi
}

show_status() {
    if [ -f "$MAINT" ]; then
        echo "  maintenance: ON   $(tr '
' ' ' < "$MAINT" | tr -s ' ')"
    else
        echo "  maintenance: off"
    fi
    echo "  container:   $(docker inspect -f '{{.State.Status}}' aniroll-api 2>/dev/null || echo 'not created')"
    echo "  nginx site:  $(test -f "$SITE" && echo enabled || echo disabled)"
    echo "  api local:   $(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:3001/api/maintenance || echo 'no answer')"
    echo "  site public: HTTP $(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$URL/" || echo '000')"
}

reload_nginx() {
    nginx -t >/dev/null
    systemctl reload nginx
}

case "${1:-status}" in
on)
    require_root
    note="$(printf '%s' "${2:-}" | tr -d '"\\')"
    mkdir -p "$DATA"
    printf '{\n  "maintenance": true,\n  "since": "%s",\n  "note": "%s"\n}\n' \
        "$(date -u +%FT%TZ)" "$note" > "$MAINT"
    echo "Maintenance mode ON — clients stop background syncing within a minute."
    show_status
    ;;

off)
    require_root
    rm -f "$MAINT"
    echo "Maintenance mode OFF — clients resume within a minute."
    show_status
    ;;

offline)
    require_root
    [ -f "$SITE" ] && mv "$SITE" "$SITE_OFF"
    reload_nginx
    docker stop aniroll-api >/dev/null 2>&1 || true
    echo "AniRoll is offline — nginx site removed, API container stopped."
    show_status
    ;;

online)
    require_root
    [ -f "$SITE_OFF" ] && mv "$SITE_OFF" "$SITE"
    reload_nginx
    if [ -z "$(docker ps -q -f name=aniroll-api)" ]; then
        if [ -n "$(docker ps -aq -f name=aniroll-api)" ]; then
            docker start aniroll-api >/dev/null
        else
            # Recreated from scratch: JF_SECRET has to come along, or stored Jellyfin
            # API keys can no longer be decrypted
            docker run -d --name aniroll-api --restart unless-stopped \
                -e JF_SECRET="$(cat "$SECRET")" \
                -v "$DATA":/app/data \
                -p 127.0.0.1:3001:3001 aniroll-api >/dev/null
        fi
    fi
    echo "AniRoll is online again."
    show_status
    ;;

status)
    echo "AniRoll status:"
    show_status
    ;;

-h | --help | help)
    usage
    ;;

*)
    echo "Unknown command: $1" >&2
    echo >&2
    usage >&2
    exit 1
    ;;
esac
