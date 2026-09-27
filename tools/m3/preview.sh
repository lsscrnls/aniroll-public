#!/usr/bin/env bash
# Screenshots of the M3 design with the demo account (see preview.js). Needs Docker.
#   tools/m3/preview.sh dark home roll      DESIGN=aniroll tools/m3/preview.sh   EXTRA='{"aniroll_m3_seed":"#006a6a"}' ...
set -euo pipefail
cd "$(dirname "$0")/../.."
docker run --rm -v "$PWD":/work -e NODE_PATH=/tmp/e2e/node_modules -e DESIGN="${DESIGN:-m3}" -e EXTRA="${EXTRA:-}" \
    mcr.microsoft.com/playwright:v1.63.0-noble sh -c \
    "cp -r /work/tools/e2e /tmp/e2e && cd /tmp/e2e && npm ci --silent >/dev/null 2>&1 && node /work/tools/m3/preview.js $*; chown -R $(id -u):$(id -g) /work/tools/m3/out"
