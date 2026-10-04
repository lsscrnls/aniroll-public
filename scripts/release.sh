#!/usr/bin/env bash
# The version bump of a release, in one go:
#   bash scripts/release.sh            next JS version (every ?v= of the modules and APP_VERSION)
#   bash scripts/release.sh --css      also style.css?v=
#   bash scripts/release.sh --m3       also m3.css?v= (index.html and CSS_HREF in js/design.js together)
#   bash scripts/release.sh 140 ...    a version of your own instead of the next one
# The changelog (js/whatsnew.js) stays by hand; the browser checks read its entries themselves.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

target=""; css=0; m3=0
for a in "$@"; do
    case "$a" in
        --css) css=1 ;;
        --m3) m3=1 ;;
        [0-9]*) target="$a" ;;
        *) echo "unknown option: $a" >&2; exit 1 ;;
    esac
done

current=$(grep -oE "APP_VERSION = '[0-9]+'" js/app.js | grep -oE "[0-9]+")
next=${target:-$((current + 1))}
[ "$next" -gt "$current" ] || { echo "version $next is not newer than $current" >&2; exit 1; }

# Every module import and the script tag carry the same number (deploy.sh refuses mixed ones)
files=$(grep -rlE "\.js\?v=$current\b" index.html js tools/e2e 2>/dev/null || true)
[ -n "$files" ] && echo "$files" | xargs sed -i -E "s/(\.js\?v=)$current\b/\1$next/g"
sed -i -E "s/APP_VERSION = '$current'/APP_VERSION = '$next'/" js/app.js
echo "JS v$current -> v$next ($(echo "$files" | grep -c . || true) files)"

if [ "$css" = 1 ]; then
    c=$(grep -oE "style\.css\?v=[0-9]+" index.html | grep -oE "[0-9]+$")
    sed -i -E "s/style\.css\?v=$c\b/style.css?v=$((c + 1))/" index.html
    echo "style.css v$c -> v$((c + 1))"
fi
if [ "$m3" = 1 ]; then
    c=$(grep -oE "m3\.css\?v=[0-9]+" index.html | grep -oE "[0-9]+$")
    sed -i -E "s/m3\.css\?v=$c\b/m3.css?v=$((c + 1))/" index.html js/design.js
    echo "m3.css v$c -> v$((c + 1)) (index.html and js/design.js)"
fi

left=$(grep -rnoE "\.js\?v=[0-9]+" index.html js | grep -v "v=$next" || true)
[ -z "$left" ] || { echo "still on another version:" >&2; echo "$left" >&2; exit 1; }
echo "done; add the changelog entry in js/whatsnew.js if users should hear about it"
