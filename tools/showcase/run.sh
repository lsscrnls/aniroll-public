#!/usr/bin/env bash
# Records stills and clips (record.js) in the Playwright image, then encodes them with the local ffmpeg:
#   out/clips/<name>.mp4   H.264 for the landing page (copied to media/)
#   out/clips/<name>.webp  animated, for the README (copied to docs/screenshots/)
#   out/stills/*.png → docs/screenshots/*.webp
# Usage: tools/showcase/run.sh [roll calendar match stills landing]
set -euo pipefail
cd "$(dirname "$0")/../.."
ROOT=$PWD
OUT=tools/showcase/out
mkdir -p "$OUT"
# With an NVIDIA GPU and its container runtime, Chromium renders on the GPU: blur-heavy pages (Material 3)
# then record at full frame rate instead of stalling in software rendering
GPU=()
if docker info 2>/dev/null | grep -q nvidia; then GPU=(--gpus all -e NVIDIA_DRIVER_CAPABILITIES=all -e GPU=1); fi
# The player clip plays from a real Jellyfin: JF=<file> holds { url, token, userId, userName, server } (never
# committed), the container shares the host's network to reach it, and Google Chrome replaces Playwright's
# Chromium, which cannot decode H.264 (what Jellyfin converts to)
PLAYER=()
CHROME=""
if [[ " $* " == *" player "* ]]; then
    [ -n "${JF:-}" ] && [ -f "$JF" ] || { echo "player clip: set JF=<file with the Jellyfin login>" >&2; exit 1; }
    PLAYER=(--network host -v "$JF":/jf.json:ro -e JF=/jf.json -e SHOW_ID="${SHOW_ID:-}" -e EPISODE="${EPISODE:-1}" -e SEEK="${SEEK:-}")
    CHROME="npx playwright install --with-deps chrome >/dev/null 2>&1 && "
fi
docker run --rm "${GPU[@]}" "${PLAYER[@]}" -v "$ROOT":/work -e OUT=/work/$OUT -e NODE_PATH=/tmp/e2e/node_modules \
    mcr.microsoft.com/playwright:v1.63.0-noble sh -c \
    "cp -r /work/tools/e2e /tmp/e2e && cd /tmp/e2e && npm ci --silent >/dev/null 2>&1 && ${CHROME}node /work/tools/showcase/record.js $*; chown -R $(id -u):$(id -g) /work/$OUT"

mkdir -p media docs/screenshots
for dir in "$OUT"/clips/*/; do
    [ -f "$dir/frames.txt" ] || continue
    name=$(basename "$dir")
    [ $# -eq 0 ] || [[ " $* " == *" $name "* ]] || continue
    ffmpeg -loglevel error -y -f concat -safe 0 -i "$dir/frames.txt" -vf "fps=30,scale=1280:-2" \
        -c:v libx264 -crf 24 -preset slow -pix_fmt yuv420p -movflags +faststart -an "media/$name.mp4"
    ffmpeg -loglevel error -y -f concat -safe 0 -i "$dir/frames.txt" -vf "fps=15,scale=800:-2:flags=lanczos" \
        -c:v libwebp -quality 62 -compression_level 6 -loop 0 -an "docs/screenshots/clip-$name.webp"
    # Poster: the last frame shows the outcome (result, opened panel), also what "reduce motion" gets
    ffmpeg -loglevel error -y -sseof -0.2 -i "media/$name.mp4" -frames:v 1 -q:v 4 "media/$name.jpg"
    echo "clip $name: media/$name.mp4 ($(du -h "media/$name.mp4" | cut -f1)), docs/screenshots/clip-$name.webp ($(du -h "docs/screenshots/clip-$name.webp" | cut -f1))"
done
for png in "$OUT"/stills/*.png; do
    [ -f "$png" ] || continue
    name=$(basename "$png" .png)
    if [[ $name == mobile-* ]]; then magick "$png" -resize 50% -quality 85 "docs/screenshots/$name.webp"
    else magick "$png" -quality 82 "docs/screenshots/$name.webp"; fi
done
echo done
