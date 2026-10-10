#!/usr/bin/env bash
# Renders the store art (discord/store/render.js) into dist/store/. Needs discord/build.sh first.
set -euo pipefail
cd "$(dirname "$0")/../.."
mkdir -p dist/store
docker run --rm --network host -v "$PWD":/work:ro -v "$PWD/discord/extension":/ext:ro -v "$PWD/dist/store":/out \
    mcr.microsoft.com/playwright:v1.63.0-noble sh -c '
    set -e
    mkdir -p /root/.config/chromium /tmp/profile/NativeMessagingHosts
    /work/downloads/discord/aniroll-discord-linux-amd64 </dev/null >/dev/null
    cp /root/.config/chromium/NativeMessagingHosts/*.json /tmp/profile/NativeMessagingHosts/
    (cd /work && python3 -m http.server 3000 >/dev/null 2>&1 &)
    mkdir -p /tmp/t && cd /tmp/t && npm init -y >/dev/null && npm i --silent playwright@1.63.0 >/dev/null 2>&1
    cp /work/discord/store/render.js . && node render.js
    chown -R '"$(id -u):$(id -g)"' /out'
cp discord/extension/icons/icon-128.png dist/store/icon-128.png
ls dist/store
