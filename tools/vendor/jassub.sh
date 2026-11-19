#!/usr/bin/env bash
# Bundles JASSUB (libass in WebAssembly, for styled ASS/SSA subtitles) into js/vendor/jassub-<version>/.
# JASSUB ships with bare imports (abslink, rvfc-polyfill, ...), which a browser without a bundler cannot
# resolve: esbuild folds them into one module for the page and one for the worker, once, here — the app
# itself stays without a build step. Needs Docker.   bash tools/vendor/jassub.sh [version]
set -euo pipefail
cd "$(dirname "$0")/../.."
VERSION="${1:-2.5.18}"
# The folder name carries our patch level too: /js/vendor/ is cached as immutable, so a changed patch needs a new path
PATCH="p4"
OUT="js/vendor/jassub-$VERSION$PATCH"
rm -rf "$OUT"
mkdir -p "$OUT"
docker run --rm -v "$PWD/$OUT":/out -w /tmp/b node:24-alpine sh -c "
    npm init -y >/dev/null && npm i --silent jassub@$VERSION esbuild@0.25 >/dev/null 2>&1 &&
    P=node_modules/jassub/dist &&
    npx esbuild \$P/jassub.js --bundle --format=esm --minify --legal-comments=eof --outfile=/out/jassub.js &&
    npx esbuild \$P/worker/worker.js --bundle --format=esm --minify --legal-comments=eof --outfile=/out/worker/worker.js &&
    mkdir -p /out/wasm && cp \$P/wasm/*.wasm /out/wasm/ && cp \$P/default.woff2 /out/ &&
    cp node_modules/jassub/LICENSE /out/LICENSE.txt &&
    chown -R $(id -u):$(id -g) /out"
# Firefox and Windows: keep the drawing buffer, draw in sync (no low-latency "desynchronized" canvas) and draw with
# the 2D canvas renderer (the worker's own fallback) instead of WebGL. Linux and macOS Chromium keep JASSUB's own path.
#   Firefox: WebGL and low-latency canvases let a blank frame through now and then (styled subtitles blinked away).
#   Windows: in Brave (AMD APU) the video went black under the WebGL canvas once the controls hid, the subtitles kept
#   drawing; with the Firefox path the picture stayed (tested 2026-11-17 by passing Brave off as Firefox). A Chromium
#   compositor bug on Windows, so a workaround: drop it once Chromium fixes it.
# Which of the two does it on Windows is still open: the worker URL's ?r= turns either back on there, for testing
# (js/player/subtitles.js passes localStorage aniroll_jassub through): "webgl", "desync", or "webgl desync" (JASSUB's own).
FF='/firefox/i.test(navigator.userAgent)'
WIN='/Windows/.test(navigator.userAgent)'
SYNC="($FF||$WIN&&!/desync/.test(location.search))"
TWO_D="($FF||$WIN&&!/webgl/.test(location.search))"
# & stands for the match in a sed replacement
SYNC_R="${SYNC//&/\\&}"
TWO_D_R="${TWO_D//&/\\&}"
sed -i "s#preserveDrawingBuffer:!1,stencil:!1,desynchronized:!0#preserveDrawingBuffer:$SYNC_R,stencil:!1,desynchronized:!$SYNC_R#g; s#desynchronized:!0,willReadFrequently#desynchronized:!$SYNC_R,willReadFrequently#g" "$OUT/worker/worker.js"
[ "$(grep -o 'desynchronized:!0' "$OUT/worker/worker.js" | wc -l)" = 0 ] || { echo "sync patch did not apply everywhere" >&2; exit 1; }
[ "$(grep -oF "desynchronized:!$SYNC" "$OUT/worker/worker.js" | wc -l)" = 4 ] || { echo "sync patch: expected 4 canvases" >&2; exit 1; }
sed -i 's#try{let \([A-Za-z_$]*\)=new OffscreenCanvas(1,1);\1.getContext("webgl2")#try{if('"$TWO_D_R"')throw 0;let \1=new OffscreenCanvas(1,1);\1.getContext("webgl2")#' "$OUT/worker/worker.js"
grep -qF "try{if($TWO_D)throw 0;" "$OUT/worker/worker.js" || { echo "2D patch did not apply" >&2; exit 1; }
# All three renderers: a resize back to the size the canvas already has left an older, still pending resize in
# place, so the canvas took that old size while libass drew for the new one: the subtitles came out enlarged from
# the top left corner, cut off at the bottom and the right (seen going full screen, 1440 vs. ~1320 pixels high).
# Now the latest size always wins: one the canvas has already drops what was pending.
OLD_RS='resizeCanvas(r,o){!r||!o||this.canvas?.width===r\&\&this.canvas?.height===o||(this._scheduledResize={width:r,height:o})}'
NEW_RS='resizeCanvas(r,o){!r||!o||(this._scheduledResize=this.canvas?.width===r\&\&this.canvas?.height===o?void 0:{width:r,height:o})}'
[ "$(grep -oF 'resizeCanvas(r,o){!r||!o||this.canvas?.width===r&&this.canvas?.height===o||(this._scheduledResize={width:r,height:o})}' "$OUT/worker/worker.js" | wc -l)" = 3 ] || { echo "resize patch: expected 3 renderers" >&2; exit 1; }
sed -i "s#$OLD_RS#$NEW_RS#g" "$OUT/worker/worker.js"
[ "$(grep -oF 'this._scheduledResize=this.canvas?.width===r&&this.canvas?.height===o?void 0:' "$OUT/worker/worker.js" | wc -l)" = 3 ] || { echo "resize patch did not apply" >&2; exit 1; }
cat > "$OUT/README.txt" <<TXT
JASSUB $VERSION (https://github.com/ThaUnknown/jassub), bundled by tools/vendor/jassub.sh.
JASSUB itself is MIT (LICENSE.txt). The WebAssembly files contain libass (ISC), FreeType (FTL or GPL-2.0+),
HarfBuzz (MIT), FriBidi (LGPL-2.1+) and others: npm license field
"LGPL-2.1-or-later AND (FTL OR GPL-2.0-or-later) AND MIT AND MIT-Modern-Variant AND ISC AND NTP AND Zlib AND BSL-1.0".
They are served as separate files and can be replaced. default.woff2 is Liberation Sans (SIL OFL 1.1).
worker/worker.js is patched for Firefox and Windows (2D canvas renderer, kept drawing buffer, no desynchronized canvas) and so that
a pending canvas resize never outlives a newer one: see tools/vendor/jassub.sh.
TXT
ls -la "$OUT" "$OUT/worker" "$OUT/wasm"
