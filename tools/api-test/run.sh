#!/usr/bin/env bash
# Runs every check: matcher parity, relay safety, post rendering, then the API checks against a fresh
# mock and a fresh copy of api/server.js (both keep state, so each run starts clean).
# Used by CI (.github/workflows/checks.yml) and locally: tools/api-test/run.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
work="$(mktemp -d)"
pids=()
cleanup() { [ ${#pids[@]} -eq 0 ] || kill "${pids[@]}" 2>/dev/null || true; rm -rf "$work"; }
trap cleanup EXIT

node "$here/matchparity.js"
node "$here/relaytest.js"
node "$here/formattest.js"
node "$here/storagetest.js"

port_open() { (echo > "/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
for port in 3001 3099; do
    if port_open "$port"; then
        echo "port $port is in use - stop the old mock/server first" >&2
        exit 1
    fi
done

cp "$root/api/server.js" "$root/api/party.js" "$work/"
node "$here/mockanilist.js" > "$work/mock.log" 2>&1 &
pids+=($!)
(cd "$work" && exec env ANILIST_URL=http://127.0.0.1:3099 JF_SECRET=local-test-secret-0123456789abcdef \
    ANILIST_BUDGET_PER_MIN=200 VERIFY_PAUSE_MS=1000 MAX_SEATS=2 node server.js > "$work/server.log" 2>&1) &
pids+=($!)

for _ in $(seq 50); do
    port_open 3001 && port_open 3099 && break
    sleep 0.1
done

if ! node "$here/apitest.js"; then
    echo "--- server log ---" >&2
    tail -n 40 "$work/server.log" >&2
    exit 1
fi
