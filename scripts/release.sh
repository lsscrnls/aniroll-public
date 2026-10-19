#!/usr/bin/env bash
# The version number of a release (RELEASE in js/whatsnew.js) and CHANGELOG.md, in one go:
#   bash scripts/release.sh            an internal fix: 1.5.1 -> 1.5.1.1 -> 1.5.1.2
#   bash scripts/release.sh --patch    1.5.1.2 -> 1.5.2
#   bash scripts/release.sh --minor    1.5.2 -> 1.6.0
#   bash scripts/release.sh --major    1.6.0 -> 2.0.0
# Caches are no longer busted by hand: scripts/deploy.sh fingerprints every module and stylesheet it uploads.
# The changelog (js/whatsnew.js) stays by hand; the browser checks read its entries themselves.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

bump=fix
for a in "$@"; do
    case "$a" in
        --patch) bump=patch ;;
        --minor) bump=minor ;;
        --major) bump=major ;;
        *) echo "unknown option: $a" >&2; exit 1 ;;
    esac
done

rel=$(grep -oE "RELEASE = '[0-9]+(\.[0-9]+){2,3}'" js/whatsnew.js | grep -oE "[0-9.]+[0-9]")
IFS=. read -r ma mi pa fx <<< "$rel"
case "$bump" in
    major) newrel="$((ma + 1)).0.0" ;;
    minor) newrel="$ma.$((mi + 1)).0" ;;
    patch) newrel="$ma.$mi.$((pa + 1))" ;;
    *) newrel="$ma.$mi.$pa.$((${fx:-0} + 1))" ;;
esac
sed -i -E "s/RELEASE = '$rel'/RELEASE = '$newrel'/" js/whatsnew.js
echo "AniRoll $rel -> $newrel"

# CHANGELOG.md mirrors "What's new" for GitHub (add the entry in js/whatsnew.js before this script)
node scripts/changelog.js
echo "done; a changelog entry added after this needs: node scripts/changelog.js"
