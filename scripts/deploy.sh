#!/usr/bin/env bash
# Deploys AniRoll to the server in one go: checks, then frontend, API and nginx as asked.
#
#   scripts/deploy.sh             frontend only (index.html, css, js, icons, manifest, images)
#   scripts/deploy.sh --api       also api/server.js + api/party.js: rebuild the image, restart the container
#   scripts/deploy.sh --nginx     also deploy/nginx/aniroll.conf: nginx -t, reload, roll back on error
#   scripts/deploy.sh --dry-run   run the checks, upload nothing
#
# Before uploading it checks that every ?v= import and APP_VERSION agree and that every
# module parses — both were manual steps that were easy to forget.
# The modules in scripts/protected.txt go up obfuscated (tools/obfuscate, in Docker); the repo keeps them readable.
set -euo pipefail

SERVER="root@89.58.4.162"
WEBROOT="/var/www/aniroll"
API_DIR="/opt/aniroll-api"
SITE="https://aniroll.app"
# What makes AniRoll AniRoll (Roll, Watch Party, taste match): the browser modules among them
mapfile -t PROTECTED < <(grep -E '^js/.*\.js$' "$(dirname "$0")/protected.txt")

cd "$(dirname "$0")/.."

WITH_API=0; WITH_NGINX=0; DRY=0
for arg in "$@"; do
    case "$arg" in
        --api) WITH_API=1 ;;
        --nginx) WITH_NGINX=1 ;;
        --dry-run) DRY=1 ;;
        -h|--help) sed -n '2,11p' "$0"; exit 0 ;;
        *) echo "unknown option: $arg" >&2; exit 2 ;;
    esac
done

step() { printf '\n== %s\n' "$1"; }
fail() { printf 'ERROR: %s\n' "$1" >&2; exit 1; }

step "Checks"
# One JS version everywhere (favicon.svg?v= is versioned separately, style.css has its own)
js_versions=$(grep -rhoE "\.js\?v=[0-9]+" index.html js | sed 's/.*=//' | sort -u)
[ "$(echo "$js_versions" | wc -l)" -eq 1 ] || fail "mixed JS versions: $(echo $js_versions)"
app_version=$(grep -oE "APP_VERSION = '[0-9]+'" js/app.js | grep -oE "[0-9]+")
[ "$js_versions" = "$app_version" ] || fail "APP_VERSION ($app_version) != import version ($js_versions)"
css_version=$(grep -oE "style\.css\?v=[0-9]+" index.html | sed 's/.*=//')
echo "JS v$js_versions, CSS v$css_version"

tmp_check="$(mktemp -d)"
for f in js/*.js js/pages/*.js; do
    cp "$f" "$tmp_check/check.mjs"
    node --check "$tmp_check/check.mjs" || fail "syntax error in $f"
done
if [ "$WITH_API" -eq 1 ]; then
    for f in api/server.js api/party.js; do node --check "$f" || fail "syntax error in $f"; done
fi
rm -rf "$tmp_check"
echo "all modules parse"

if [ -n "$(git status --porcelain -- index.html css js api icons manifest.webmanifest favicon.svg 2>/dev/null)" ]; then
    echo "note: uncommitted changes are being deployed"
fi

if [ "$DRY" -eq 1 ]; then echo; echo "dry run: nothing uploaded"; exit 0; fi

step "Frontend"
# One tar stream over one SSH connection — the many single scp calls used to time out
files=(index.html css js)
for extra in favicon.svg manifest.webmanifest icons fonts media og-image-v3.jpg; do
    [ -e "$extra" ] && files+=("$extra")
done
# Uploaded from a copy, so the protected modules can be obfuscated without touching the repo
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
cp -r "${files[@]}" "$stage/"
docker run --rm -v "$PWD/tools/obfuscate:/o:ro" -v "$stage:/s" -w /s node:24-alpine sh -c \
    "cp -r /o /tmp/o && cd /tmp/o && npm ci --silent >/dev/null 2>&1 && cd /s && node /tmp/o/run.js ${PROTECTED[*]} && chown -R $(id -u):$(id -g) /s" \
    || fail "obfuscating ${PROTECTED[*]} failed"
for f in "${PROTECTED[@]}"; do
    cp "$stage/$f" "$stage/check.mjs" && node --check "$stage/check.mjs" || fail "obfuscated $f does not parse"
done
rm -f "$stage/check.mjs"
tar -cf - -C "$stage" "${files[@]}" | ssh "$SERVER" "tar -xf - -C '$WEBROOT' && echo uploaded: ${files[*]}"

# Files that exist on the server but no longer in the repo are left alone — list them instead
stale=$(ssh "$SERVER" "cd '$WEBROOT' && find js -name '*.js' | sort" | while read -r f; do [ -e "$f" ] || echo "$f"; done)
[ -z "$stale" ] || echo "note: on the server but not in the repo: $stale"

if [ "$WITH_API" -eq 1 ]; then
    step "API"
    # The Dockerfile too: it pins the Node version the image is built on
    scp -q api/server.js api/party.js api/Dockerfile "$SERVER:$API_DIR/"
    # docker restart is not enough: server.js and party.js are copied into the image at build time.
    # Build first: if it fails (e.g. the base image cannot be pulled), the old container keeps running.
    # The container runs as uid 10001 (api/Dockerfile): data/ is handed to it after the old container
    # stopped, so nothing root-owned appears in between. Without it the server cannot read its 0600 files.
    # JF_SECRET must be passed, otherwise stored Jellyfin keys become unreadable.
    ssh "$SERVER" "docker build -q -t aniroll-api '$API_DIR' >/dev/null \
        && docker stop aniroll-api >/dev/null && docker rm aniroll-api >/dev/null \
        && chown -R 10001:10001 '$API_DIR/data' \
        && docker run -d --name aniroll-api --restart unless-stopped \
             -e JF_SECRET=\"\$(cat /root/aniroll-jf.secret)\" \
             -v '$API_DIR/data:/app/data' -p 127.0.0.1:3001:3001 aniroll-api >/dev/null \
        && sleep 2 && docker exec aniroll-api sh -c 'echo \"node \$(node --version), uid \$(id -u)\"' && docker logs aniroll-api 2>&1 | tail -2"
fi

if [ "$WITH_NGINX" -eq 1 ]; then
    step "nginx"
    scp -q deploy/nginx/aniroll.conf "$SERVER:/tmp/aniroll.conf.new"
    ssh "$SERVER" 'set -e
        cp /etc/nginx/sites-enabled/aniroll /root/aniroll-nginx.bak
        cp /tmp/aniroll.conf.new /etc/nginx/sites-enabled/aniroll
        if nginx -t 2>&1; then
            systemctl reload nginx && echo "nginx reloaded"
        else
            cp /root/aniroll-nginx.bak /etc/nginx/sites-enabled/aniroll
            echo "nginx -t failed, previous config restored" >&2
            exit 1
        fi'
fi

step "Verify"
live_js=$(curl -fsS "$SITE/js/app.js" | grep -oE "\?v=[0-9]+" | sed 's/.*=//' | sort -u)
[ "$live_js" = "$js_versions" ] || fail "live app.js imports v$live_js, expected v$js_versions"
curl -fsS "$SITE/" | grep -q "style.css?v=$css_version" || fail "live index.html does not load CSS v$css_version"
echo "live: JS v$live_js, CSS v$css_version"
api_status=$(curl -s -o /dev/null -w '%{http_code}' "$SITE/api/maintenance")
[ "$api_status" = "200" ] || fail "API answered $api_status"
echo "API: 200"
echo; echo "deploy done"
