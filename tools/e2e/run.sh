#!/usr/bin/env bash
# Browser checks in the Playwright container, against the working copy.
#   bash tools/e2e/run.sh              the groups the uncommitted changes touch (everything when unsure)
#   bash tools/e2e/run.sh all          every group (what scripts/deploy.sh runs on the obfuscated build)
#   bash tools/e2e/run.sh player misc  just these (groups: main party discover player seats misc private)
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"

groups=""
if [ "${1:-}" = "all" ]; then
    groups=""
elif [ $# -gt 0 ]; then
    groups="$(IFS=,; echo "$*")"
else
    # Which parts a change reaches; anything not listed (shared code, the tests themselves) runs it all
    changed="$( (git diff --name-only HEAD; git ls-files --others --exclude-standard) | sort -u)"
    picked=()
    all=0
    while read -r f; do
        [ -z "$f" ] && continue
        case "$f" in
            js/pages/play.js|js/player/*|tools/e2e/jellyfin-mock.js|tools/e2e/media/*) picked+=(player) ;;
            js/pages/watchparty.js) picked+=(party) ;;
            js/drift.js|js/pages/shelf.js|js/touches.js|tools/e2e/private.js) picked+=(private) ;;
            js/whatsnew.js|js/landing.js) picked+=(misc) ;;
            js/seat.js|js/pages/admin.js) picked+=(seats) ;;
            js/pages/studio.js|js/pages/season.js) picked+=(discover) ;;
            js/pages/list.js|js/pages/roll.js|js/pages/calendar.js|js/pages/social.js|js/pages/search.js|js/pages/settings.js) picked+=(main) ;;
            *.md|docs/*|scripts/*|api/*|tools/api-test/*|tools/showcase/*|tools/m3/*) ;;
            *) all=1 ;;
        esac
    done <<< "$changed"
    if [ "$all" = 1 ] || [ ${#picked[@]} -eq 0 ]; then
        groups=""
        [ -z "$changed" ] && echo "no changes: running everything" >&2
    else
        groups="$(printf '%s\n' "${picked[@]}" | sort -u | paste -sd, -)"
    fi
fi

echo "browser checks: ${groups:-all groups}" >&2
docker run --rm -e E2E_ONLY="$groups" -v "$root":/work mcr.microsoft.com/playwright:v1.63.0-noble sh -c \
    "cp -r /work/tools/e2e /tmp/e2e && cd /tmp/e2e && npm ci --silent && sed -i \"s#path.join(__dirname, '..', '..')#'/work'#\" run.js jellyfin-mock.js && node run.js"
