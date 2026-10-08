#!/usr/bin/env bash
# A short promo video (1920×1080, no sound) that shows what sets AniRoll apart: title cards, Roll, a Watch Party
# from both sides (the real API server, see record.js "party"), and the Jellyfin player (media/player.mp4).
#   tools/showcase/promo.sh             record the scenes, then cut → tools/showcase/out/promo/aniroll-promo.mp4
#   NO_RECORD=1 tools/showcase/promo.sh  only cut again from the frames already recorded
set -euo pipefail
cd "$(dirname "$0")/../.."
ROOT=$PWD
OUT=tools/showcase/out
P=$OUT/promo
if [ -z "${NO_RECORD:-}" ]; then
    docker run --rm -v "$ROOT":/work -e OUT=/work/$OUT -e NODE_PATH=/tmp/e2e/node_modules \
        mcr.microsoft.com/playwright:v1.63.0-noble sh -c \
        "cp -r /work/tools/e2e /tmp/e2e && cd /tmp/e2e && npm ci --silent >/dev/null 2>&1 && node /work/tools/showcase/record.js cards promo-roll party; chown -R $(id -u):$(id -g) /work/$OUT"
fi

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
V="scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0x141218,fps=30,format=yuv420p,setsar=1"
enc=(-c:v libx264 -crf 18 -preset medium -an)

# A card: the still, faded in from and out to the page's dark
card() {
    local d=$2
    ffmpeg -loglevel error -y -loop 1 -t "$d" -i "$P/cards/$1.png" \
        -vf "$V,fade=t=in:st=0:d=0.35:color=0x141218,fade=t=out:st=$(awk "BEGIN{print $d - 0.35}"):d=0.35:color=0x141218" "${enc[@]}" "$work/$1.mp4"
}
card card-roll 2.4
card card-party 2.4
card card-player 2.4
card card-end 4

# Roll, cut where the result has settled
ffmpeg -loglevel error -y -f concat -safe 0 -i "$P/roll/frames.txt" -t 8.5 -vf "$V" "${enc[@]}" "$work/roll.mp4"

# The party: both windows side by side, the shorter one holding its last frame, a bit faster than real time
ffmpeg -loglevel error -y -f concat -safe 0 -i "$P/party-host/frames.txt" -f concat -safe 0 -i "$P/party-guest/frames.txt" -filter_complex \
    "[0]fps=30,scale=960:1080,tpad=stop_mode=clone:stop_duration=3[a];[1]fps=30,scale=960:1080,tpad=stop_mode=clone:stop_duration=3[b];\
[a][b]hstack=shortest=1,setpts=PTS/1.3,$V" "${enc[@]}" "$work/party.mp4"

# The player clip of the landing page: the detail page, the episode list, the stream with intro skip and subtitles
# (without the second where the stream is still loading)
ffmpeg -loglevel error -y -i media/player.mp4 -filter_complex \
    "[0]trim=0:5,setpts=PTS-STARTPTS[a];[0]trim=5.9:13,setpts=PTS-STARTPTS[b];[a][b]concat=n=2:v=1,$V" "${enc[@]}" "$work/player.mp4"

printf "file '%s'\n" card-roll.mp4 roll.mp4 card-party.mp4 party.mp4 card-player.mp4 player.mp4 card-end.mp4 > "$work/list.txt"
ffmpeg -loglevel error -y -f concat -safe 0 -i "$work/list.txt" -c:v libx264 -crf 20 -preset slow -pix_fmt yuv420p -movflags +faststart -an "$P/aniroll-promo.mp4"
echo "promo: $P/aniroll-promo.mp4 ($(du -h "$P/aniroll-promo.mp4" | cut -f1), $(ffprobe -v error -show_entries format=duration -of csv=p=0 "$P/aniroll-promo.mp4" | cut -d. -f1) s)"
