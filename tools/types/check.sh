#!/usr/bin/env bash
# Type checks of the browser modules that start with // @ts-check (JSDoc types, no build):
#   bash tools/types/check.sh            (installs TypeScript here on first use)
# TypeScript can't resolve the cache-busting `?v=N` in our imports, so it checks a copy of js/
# with those stripped; line numbers stay the same and errors point at the real files.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
[ -x "$here/node_modules/.bin/tsc" ] || (cd "$here" && npm install --silent >/dev/null)

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
cp -r "$root/js" "$tmp/js"
find "$tmp/js" -name '*.js' -not -path '*/vendor/*' -exec sed -i -E "s/(\.js)\?v=[0-9]+(['\"])/\1\2/g" {} +
cp "$here/tsconfig.json" "$tmp/tsconfig.json"
cp "$here/globals.d.ts" "$tmp/globals.d.ts"

cd "$tmp"
if out=$("$here/node_modules/.bin/tsc" -p tsconfig.json --pretty false 2>&1); then
    echo "types: $(grep -l '^// @ts-check' -r js --include='*.js' | wc -l) checked modules ok"
else
    echo "$out" | sed "s#^js/#js/#"
    echo "types: $(echo "$out" | grep -c 'error TS') errors" >&2
    exit 1
fi
