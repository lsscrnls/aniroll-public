#!/bin/sh
# Removes AniRoll for Discord's helper from Linux or macOS (what the browsers were told, and the program).
#   curl -fsSL https://aniroll.app/downloads/discord/uninstall.sh | sh
case "$(uname -s)" in
    Darwin) dir="$HOME/Library/Application Support/AniRoll Discord" ;;
    *) dir="${XDG_DATA_HOME:-$HOME/.local/share}/aniroll-discord" ;;
esac
if [ -x "$dir/aniroll-discord" ]; then
    "$dir/aniroll-discord" uninstall </dev/null
else
    echo "AniRoll for Discord is not set up on this computer."
fi
