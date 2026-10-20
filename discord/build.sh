#!/usr/bin/env bash
# Builds AniRoll for Discord into downloads/discord/ (served at aniroll.app/downloads/discord/):
# the helper for each system, its install lines, and the extension as a zip. Linux and macOS get the Go
# helper (discord/helper), Windows the Python one (discord/windows) with the embeddable Python from python.org.
# Skipped when nothing in discord/ changed since the last build. Go runs in Docker.
set -euo pipefail
cd "$(dirname "$0")/.."
out=downloads/discord
stamp="$out/.built"
# Settings → Discord points out an older helper by this number: both have to say the same
helper_v=$(grep -oE 'version += "[0-9.]+"' discord/helper/main.go | grep -oE '[0-9.]+')
page_v=$(grep -oE "HELPER_LATEST = '[0-9.]+'" js/presence.js | grep -oE '[0-9.]+')
[ "$helper_v" = "$page_v" ] || { echo "helper is $helper_v but js/presence.js HELPER_LATEST is $page_v" >&2; exit 1; }
win_v=$(grep -oE "^VERSION = '[0-9.]+'" discord/windows/helper.py | grep -oE '[0-9.]+')
page_win=$(grep -oE "HELPER_LATEST_WINDOWS = '[0-9.]+'" js/presence.js | grep -oE '[0-9.]+')
[ "$win_v" = "$page_win" ] || { echo "Windows helper is $win_v but js/presence.js HELPER_LATEST_WINDOWS is $page_win" >&2; exit 1; }
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
    chown -R '"$(id -u):$(id -g)"' /out'
cp discord/install.sh "$out/install.sh"
cp discord/uninstall.sh "$out/uninstall.sh"
rm -f "$out/aniroll-discord-windows.exe" "$out/aniroll-discord-uninstall.exe"  # the Go helper of 1.0.x
# Windows: Python's own embeddable build (signed by the PSF, so Smart App Control lets it run), helper.py
# and the .bat the browsers start, one zip per processor; install.ps1 checks the zip by the hash written into it
python3 - "$out" <<'PY'
import hashlib, io, sys, urllib.request, zipfile
out = sys.argv[1]
PY_V = '3.14.8'
EMBED = {  # python.org/ftp/python/<version>/python-<version>-embed-<arch>.zip
    'amd64': ('aniroll-discord-windows.zip', 'a93abe456ab01bd96d7a085b3cdb6566b3063f4241360d114142fbdb07f0a310'),
    'arm64': ('aniroll-discord-windows-arm64.zip', '155be84ccb57c6331cf0e39001c78a1dfac3be62f403f3ff5f2e29b80dda7ebe'),
}
script = open('discord/windows/install.ps1', encoding='utf-8').read()
for arch, (name, want) in EMBED.items():
    url = f'https://www.python.org/ftp/python/{PY_V}/python-{PY_V}-embed-{arch}.zip'
    data = urllib.request.urlopen(url, timeout=60).read()
    if hashlib.sha256(data).hexdigest() != want:
        sys.exit(f'{url} is not the file it should be')
    # Fixed dates: the same files give the same zip (and hash)
    buf = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(data)) as src, zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as z:
        for info in src.infolist():
            z.writestr(zipfile.ZipInfo('python/' + info.filename, (2020, 1, 1, 0, 0, 0)), src.read(info), zipfile.ZIP_DEFLATED)
        for f in ('helper.py', 'aniroll-discord.bat'):
            z.writestr(zipfile.ZipInfo(f, (2020, 1, 1, 0, 0, 0)), open(f'discord/windows/{f}', 'rb').read(), zipfile.ZIP_DEFLATED)
    open(f'{out}/{name}', 'wb').write(buf.getvalue())
    script = script.replace(f'__SHA256_{arch.upper()}__', hashlib.sha256(buf.getvalue()).hexdigest().upper())
open(f'{out}/install.ps1', 'w', encoding='utf-8', newline='\r\n').write(script)
PY
cp discord/windows/uninstall.ps1 "$out/uninstall.ps1"
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
