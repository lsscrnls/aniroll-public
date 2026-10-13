#!/usr/bin/env bash
# Bundles JASSUB (libass in WebAssembly, for styled ASS/SSA subtitles) into js/vendor/jassub-<version>/.
# JASSUB ships with bare imports (abslink, rvfc-polyfill, ...), which a browser without a bundler cannot
# resolve: esbuild folds them into one module for the page and one for the worker, once, here — the app
# itself stays without a build step. Needs Docker.   bash tools/vendor/jassub.sh [version]
set -euo pipefail
cd "$(dirname "$0")/../.."
VERSION="${1:-2.5.18}"
# The folder name carries our patch level too: /js/vendor/ is cached as immutable, so a changed patch needs a new path
PATCH="p2"
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
# Firefox: WebGL in the worker without a kept drawing buffer, and low-latency ("desynchronized") canvases,
# let a blank frame through now and then, so styled subtitles blink away for a moment. There, keep the
# buffer and draw in sync; other browsers are unchanged.
FF='/firefox/i.test(navigator.userAgent)'
sed -i "s#preserveDrawingBuffer:!1,stencil:!1,desynchronized:!0#preserveDrawingBuffer:$FF,stencil:!1,desynchronized:!$FF#g; s#desynchronized:!0,willReadFrequently#desynchronized:!$FF,willReadFrequently#g" "$OUT/worker/worker.js"
[ "$(grep -o 'desynchronized:!0' "$OUT/worker/worker.js" | wc -l)" = 0 ] || { echo "Firefox patch did not apply everywhere" >&2; exit 1; }
# Still a rare blink in Firefox with WebGL: there, draw with the 2D canvas renderer (the worker's own fallback)
sed -i 's#try{let \([A-Za-z_$]*\)=new OffscreenCanvas(1,1);\1.getContext("webgl2")#try{if('"$FF"')throw 0;let \1=new OffscreenCanvas(1,1);\1.getContext("webgl2")#' "$OUT/worker/worker.js"
grep -q 'try{if(/firefox/i.test(navigator.userAgent))throw 0;' "$OUT/worker/worker.js" || { echo "Firefox 2D patch did not apply" >&2; exit 1; }
cat > "$OUT/README.txt" <<TXT
JASSUB $VERSION (https://github.com/ThaUnknown/jassub), bundled by tools/vendor/jassub.sh.
JASSUB itself is MIT (LICENSE.txt). The WebAssembly files contain libass (ISC), FreeType (FTL or GPL-2.0+),
HarfBuzz (MIT), FriBidi (LGPL-2.1+) and others: npm license field
"LGPL-2.1-or-later AND (FTL OR GPL-2.0-or-later) AND MIT AND MIT-Modern-Variant AND ISC AND NTP AND Zlib AND BSL-1.0".
They are served as separate files and can be replaced. default.woff2 is Liberation Sans (SIL OFL 1.1).
worker/worker.js is patched for Firefox (2D canvas renderer, kept drawing buffer, no desynchronized canvas): see tools/vendor/jassub.sh.
TXT
ls -la "$OUT" "$OUT/worker" "$OUT/wasm"
