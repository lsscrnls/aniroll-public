#!/usr/bin/env bash
# Builds AniRoll for Discord into downloads/discord/ (served at aniroll.app/downloads/discord/):
# the helper for each system, its install line for Linux and macOS, and the extension as a zip.
# Skipped when nothing in discord/ changed since the last build. Go runs in Docker.
set -euo pipefail
cd "$(dirname "$0")/.."
out=downloads/discord
stamp="$out/.built"
# Settings → Discord points out an older helper by this number: both have to say the same
helper_v=$(grep -oE 'version += "[0-9.]+"' discord/helper/main.go | grep -oE '[0-9.]+')
page_v=$(grep -oE "HELPER_LATEST = '[0-9.]+'" js/presence.js | grep -oE '[0-9.]+')
[ "$helper_v" = "$page_v" ] || { echo "helper is $helper_v but js/presence.js HELPER_LATEST is $page_v" >&2; exit 1; }
ext_v=$(grep -oE '"version": "[0-9.]+"' discord/extension/manifest.json | grep -oE '[0-9.]+')
page_ext=$(grep -oE "EXTENSION_LATEST = '[0-9.]+'" js/presence.js | grep -oE '[0-9.]+')
[ "$ext_v" = "$page_ext" ] || { echo "extension is $ext_v but js/presence.js EXTENSION_LATEST is $page_ext" >&2; exit 1; }
if [ -f "$stamp" ] && [ -z "$(find discord -newer "$stamp" -type f | head -1)" ]; then echo "discord: up to date"; exit 0; fi
mkdir -p "$out"
docker run --rm -v "$PWD/discord/helper:/src:ro" -v "$PWD/$out:/out" -w /src -e CGO_ENABLED=0 -e GOFLAGS=-trimpath golang:1.24-alpine sh -c '
    set -e
    b() { GOOS=$1 GOARCH=$2 go build -ldflags "-s -w" -o "/out/$3" .; }
    b linux amd64 aniroll-discord-linux-amd64
    b linux arm64 aniroll-discord-linux-arm64
    b darwin arm64 aniroll-discord-macos-arm64
    b darwin amd64 aniroll-discord-macos-amd64
    b windows amd64 aniroll-discord-windows.exe
    chown -R '"$(id -u):$(id -g)"' /out'
cp discord/install.sh "$out/install.sh"
cp discord/uninstall.sh "$out/uninstall.sh"
# The same program under another name removes itself when double-clicked (Windows)
cp "$out/aniroll-discord-windows.exe" "$out/aniroll-discord-uninstall.exe"
rm -f "$out/aniroll-discord-extension.zip"
python3 -c "import shutil,sys; shutil.make_archive(sys.argv[1], 'zip', 'discord/extension')" "$out/aniroll-discord-extension"
touch "$stamp"
ls -la "$out" | awk 'NR>1 {print $5, $9}'

# For the Chrome Web Store: no "key" (the store gives its own id) and no localhost
mkdir -p dist
python3 - <<'PY'
import json, zipfile, os
src = 'discord/extension'
m = json.load(open(f'{src}/manifest.json'))
m.pop('key', None)
m.pop('browser_specific_settings', None)  # Firefox only
for cs in m['content_scripts']:
    cs['matches'] = [u for u in cs['matches'] if 'localhost' not in u]
with zipfile.ZipFile('dist/aniroll-discord-chrome-store.zip', 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr('manifest.json', json.dumps(m, indent=4))
    for root, _, files in os.walk(src):
        for f in files:
            p = os.path.join(root, f)
            if f != 'manifest.json': z.write(p, os.path.relpath(p, src))
PY
echo "store package: dist/aniroll-discord-chrome-store.zip"
