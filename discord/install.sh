#!/bin/sh
# AniRoll for Discord, Linux and macOS: fetches the helper for this computer and sets it up.
#   curl -fsSL https://aniroll.app/downloads/discord/install.sh | sh
set -e
base="https://aniroll.app/downloads/discord"
case "$(uname -s)-$(uname -m)" in
    Linux-x86_64) file=aniroll-discord-linux-amd64 ;;
    Linux-aarch64|Linux-arm64) file=aniroll-discord-linux-arm64 ;;
    Darwin-arm64) file=aniroll-discord-macos-arm64 ;;
    Darwin-x86_64) file=aniroll-discord-macos-amd64 ;;
    *) echo "Sorry, there is no AniRoll for Discord helper for $(uname -s) $(uname -m) yet." >&2; exit 1 ;;
esac
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
curl -fsSL "$base/$file" -o "$tmp/aniroll-discord"
chmod +x "$tmp/aniroll-discord"
"$tmp/aniroll-discord" </dev/null
