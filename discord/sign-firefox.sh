#!/usr/bin/env bash
# Signs AniRoll for Discord for Firefox, Zen and LibreWolf (unlisted on addons.mozilla.org: signed in
# minutes, installed straight from aniroll.app) into downloads/discord/aniroll-discord-firefox.xpi.
# The AMO API key lives outside the repo: ~/.config/aniroll/amo.env (AMO_JWT_ISSUER=…, AMO_JWT_SECRET=…).
# Every signing needs a new version in discord/extension/manifest.json.
set -euo pipefail
cd "$(dirname "$0")/.."
keys="$HOME/.config/aniroll/amo.env"
[ -f "$keys" ] || { echo "missing $keys" >&2; exit 1; }
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/src" "$work/out"
cp -r discord/extension/. "$work/src/"
# No Chrome key, no localhost
python3 - "$work/src/manifest.json" <<'PY'
import json, sys
p = sys.argv[1]; m = json.load(open(p))
m.pop('key', None)
for cs in m['content_scripts']:
    cs['matches'] = [u for u in cs['matches'] if 'localhost' not in u]
json.dump(m, open(p, 'w'), indent=4)
PY
docker run --rm --env-file "$keys" -v "$work:/w" -w /w node:24-alpine sh -c \
    'npx -y web-ext@8 sign --source-dir src --artifacts-dir out --channel unlisted --api-key "$AMO_JWT_ISSUER" --api-secret "$AMO_JWT_SECRET" 2>&1 | grep -vi secret; chown -R '"$(id -u):$(id -g)"' out'
xpi=$(ls "$work"/out/*.xpi 2>/dev/null | head -1)
[ -n "$xpi" ] || { echo "signing failed" >&2; exit 1; }
version=$(python3 -c "import json;print(json.load(open('discord/extension/manifest.json'))['version'])")
mkdir -p downloads/discord
# The newest one for the install button, a numbered copy for Firefox's own update check (update_url)
cp "$xpi" downloads/discord/aniroll-discord-firefox.xpi
cp "$xpi" "downloads/discord/aniroll-discord-firefox-$version.xpi"
cat > downloads/discord/firefox-updates.json <<JSON
{ "addons": { "discord@aniroll.app": { "updates": [
    { "version": "$version", "update_link": "https://aniroll.app/downloads/discord/aniroll-discord-firefox-$version.xpi" }
] } } }
JSON
echo "signed: downloads/discord/aniroll-discord-firefox.xpi ($version)"
