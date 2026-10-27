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

cp "$root/api/server.js" "$root/api/party.js" "$root/api/animemap.js" "$root/api/sources.js" "$root/api/songs.js" "$root/api/passkeys.js" "$root/api/fallback.js" "$root/api/watchorder.js" "$work/"
# A tiny anime map instead of the real download: two parts of one TVDB season, a movie
mkdir -p "$work/data"
echo '{"at":'"$(date +%s)000"',"entries":[{"a":101,"tvdb":5001,"ts":1,"to":0,"tmdb":7001,"ms":1,"mo":0,"movie":[]},{"a":102,"tvdb":5001,"ts":1,"to":12,"tmdb":7001,"ms":1,"mo":12,"movie":[]},{"a":103,"tvdb":null,"ts":null,"to":0,"tmdb":null,"ms":null,"mo":0,"movie":[9001]}]}' > "$work/data/animemap.json"
# The passkey key: a file of its own outside data/ (as on the VPS); one passkey from before, its login sealed with
# the Jellyfin key, which the server moves to the passkey key when it starts
head -c 48 /dev/urandom | base64 > "$work/passkey.key"
node -e '
const c = require("crypto");
const key = c.createHash("sha256").update("local-test-secret-0123456789abcdef").digest();
const iv = c.randomBytes(12), ci = c.createCipheriv("aes-256-gcm", key, iv);
const enc = Buffer.concat([ci.update("old-token", "utf8"), ci.final()]);
const sealed = [iv.toString("base64"), ci.getAuthTag().toString("base64"), enc.toString("base64")].join(".");
require("fs").writeFileSync(process.argv[1], JSON.stringify({ legacy1: { userId: 4242, sealed, label: "Old", created: 1, pk: "", alg: -7, rpId: "localhost" } }));
' "$work/data/passkeys.json"
node "$here/mockanilist.js" > "$work/mock.log" 2>&1 &
pids+=($!)
(cd "$work" && exec env ANILIST_URL=http://127.0.0.1:3099 JF_SECRET=local-test-secret-0123456789abcdef PASSKEY_KEY_FILE="$work/passkey.key" \
    ANILIST_BUDGET_PER_MIN=200 VERIFY_PAUSE_MS=1000 MAX_SEATS=2 ANIME_MAP_URL= PYTHON_WATCH_SITE= ANIMETHEMES_URL=http://127.0.0.1:3099/animethemes SHAZAM_URL=http://127.0.0.1:3099/shazam TMDB_URL=http://127.0.0.1:3099/tmdb TMDB_TOKEN=test-tmdb node server.js > "$work/server.log" 2>&1) &
pids+=($!)

for _ in $(seq 50); do
    port_open 3001 && port_open 3099 && break
    sleep 0.1
done

if ! API_DATA="$work/data" PASSKEY_KEY_FILE="$work/passkey.key" node "$here/apitest.js"; then
    echo "--- server log ---" >&2
    tail -n 40 "$work/server.log" >&2
    exit 1
fi
