#!/usr/bin/env bash
# Deploys AniRoll to the server in one go: checks, then frontend, API and nginx as asked.
#
#   scripts/deploy.sh             frontend only (index.html, css, js, icons, manifest, images)
#   scripts/deploy.sh --api       also api/server.js + api/party.js: rebuild the image, restart the container
#   scripts/deploy.sh --nginx     also deploy/nginx/aniroll.conf: nginx -t, reload, roll back on error
#   scripts/deploy.sh --dry-run   run the checks, upload nothing
#   scripts/deploy.sh --no-e2e    skip the browser checks against the obfuscated build (not recommended)
#
# Every module parses before anything goes up. Cache busting is done here, not by hand: scripts/fingerprint.js
# gives each module and stylesheet in the uploaded copy a ?h= fingerprint of its content (the repo keeps plain imports).
# The modules in scripts/protected.txt go up obfuscated (tools/obfuscate, in Docker); the repo keeps them readable.
set -euo pipefail

SERVER="root@89.58.4.162"
WEBROOT="/var/www/aniroll"
API_DIR="/opt/aniroll-api"
SITE="https://aniroll.app"
# What makes AniRoll AniRoll (Roll, Watch Party, taste match): the browser modules among them
mapfile -t PROTECTED < <(grep -E '^js/.*\.js$' "$(dirname "$0")/protected.txt")

cd "$(dirname "$0")/.."

WITH_API=0; WITH_NGINX=0; DRY=0; E2E=1
for arg in "$@"; do
    case "$arg" in
        --api) WITH_API=1 ;;
        --nginx) WITH_NGINX=1 ;;
        --dry-run) DRY=1 ;;
        --no-e2e) E2E=0 ;;
        -h|--help) sed -n '2,11p' "$0"; exit 0 ;;
        *) echo "unknown option: $arg" >&2; exit 2 ;;
    esac
done

step() { printf '\n== %s\n' "$1"; }
fail() { printf 'ERROR: %s\n' "$1" >&2; exit 1; }

step "Checks"
# Plain imports in the repo: a version by hand would sit next to the fingerprint and outlive it
by_hand=$(grep -rnoE "\.(js|css)\?[vh]=[0-9a-f]+" index.html js tools/e2e/*.js | grep -v "^js/vendor/" || true)
[ -z "$by_hand" ] || fail "versioned by hand (scripts/fingerprint.js does this now): $by_hand"

tmp_check="$(mktemp -d)"
# As .mjs so they parse as modules; several at once (one node per file, 1.5 s one after the other)
for f in js/*.js js/pages/*.js js/player/*.js; do
    mkdir -p "$tmp_check/$(dirname "$f")"
    cp "$f" "$tmp_check/${f%.js}.mjs"
done
(cd "$tmp_check" && find js -name '*.mjs' -print0 | xargs -0 -n 1 -P 8 node --check) || fail "syntax error in the module named above"
if [ "$WITH_API" -eq 1 ]; then
    for f in api/server.js api/party.js api/animemap.js api/sources.js; do node --check "$f" || fail "syntax error in $f"; done
fi
rm -rf "$tmp_check"
echo "all modules parse"

# The pure logic (Home's week, scores, escaping) in milliseconds, before the slower browser checks
unit_out=$(sh tools/unit/run.sh 2>&1) || { echo "$unit_out" | grep -E "^not ok|expected|actual|Error" | head -20; fail "unit tests failed"; }
echo "unit tests: $(echo "$unit_out" | grep -oE "^ℹ pass [0-9]+" | grep -oE "[0-9]+") pass"
# JSDoc types of the modules marked // @ts-check (TypeScript only checks, nothing is built)
types_out=$(bash tools/types/check.sh 2>&1) || { echo "$types_out" | grep "error TS" | head -20; fail "type check failed"; }
echo "$types_out"

if [ -n "$(git status --porcelain -- index.html css js api icons manifest.webmanifest favicon.svg favicon.ico 2>/dev/null)" ]; then
    echo "note: uncommitted changes are being deployed"
fi

if [ "$DRY" -eq 1 ]; then echo; echo "dry run: nothing uploaded"; exit 0; fi

step "Frontend"
# AniRoll for Discord into downloads/discord (only rebuilt when discord/ changed)
bash discord/build.sh || fail "building AniRoll for Discord failed"
# One tar stream over one SSH connection — the many single scp calls used to time out
files=(index.html css js)
for extra in favicon.svg favicon.ico manifest.webmanifest robots.txt sitemap.xml move icons fonts media og-image-v4.jpg downloads; do
    [ -e "$extra" ] && files+=("$extra")
done
# Uploaded from a copy, so the protected modules can be obfuscated without touching the repo
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
cp -r "${files[@]}" "$stage/"
# Fingerprints first: the obfuscator would hide the dynamic imports' addresses
build=$(node scripts/fingerprint.js "$stage" | tee /dev/stderr | grep -oE "[0-9a-f]+$") || fail "fingerprinting failed"
docker run --rm -v "$PWD/tools/obfuscate:/o:ro" -v "$stage:/s" -w /s node:24-alpine sh -c \
    "cp -r /o /tmp/o && cd /tmp/o && npm ci --silent >/dev/null 2>&1 && cd /s && node /tmp/o/run.js ${PROTECTED[*]} && chown -R $(id -u):$(id -g) /s" \
    || fail "obfuscating ${PROTECTED[*]} failed"
for f in "${PROTECTED[@]}"; do
    cp "$stage/$f" "$stage/check.mjs" && node --check "$stage/check.mjs" || fail "obfuscated $f does not parse"
done
rm -f "$stage/check.mjs"
# What goes up is what gets tested: every page against a mocked AniList, on the obfuscated copy.
# Obfuscation once broke joining a Watch Party while the readable source worked (v99)
if [ "$E2E" -eq 1 ]; then
    echo "browser checks on the obfuscated build..."
    docker run --rm -v "$stage:/work:ro" -v "$PWD/tools/e2e:/e2e:ro" mcr.microsoft.com/playwright:v1.63.0-noble sh -c \
        "cp -r /e2e /tmp/e2e && cd /tmp/e2e && npm ci --silent >/dev/null 2>&1 && sed -i \"s#path.join(__dirname, '..', '..')#'/work'#\" run.js jellyfin-mock.js && node run.js" \
        > "$stage.e2e.log" 2>&1 || { grep -v '^PASS' "$stage.e2e.log" >&2; rm -f "$stage.e2e.log"; fail "browser checks failed on the obfuscated build, nothing uploaded"; }
    echo "$(grep -c '^PASS' "$stage.e2e.log") browser checks passed"
    rm -f "$stage.e2e.log"
fi
# index.html and version.json last: whoever loads the page meanwhile gets the old one, not addresses not up yet
upload=()
for f in "${files[@]}"; do [ "$f" = index.html ] || upload+=("$f"); done
upload+=(index.html version.json)
tar -cf - -C "$stage" "${upload[@]}" | ssh "$SERVER" "tar -xf - -C '$WEBROOT' && echo uploaded: ${upload[*]}"

# Files that exist on the server but no longer in the repo are left alone — list them instead
stale=$(ssh "$SERVER" "cd '$WEBROOT' && find js -name '*.js' | sort" | while read -r f; do [ -e "$f" ] || echo "$f"; done)
[ -z "$stale" ] || echo "note: on the server but not in the repo: $stale"

if [ "$WITH_API" -eq 1 ]; then
    step "API"
    # The Dockerfile too: it pins the Node version the image is built on
    scp -q api/server.js api/party.js api/animemap.js api/sources.js api/songs.js api/Dockerfile "$SERVER:$API_DIR/"
    # docker restart is not enough: server.js and party.js are copied into the image at build time.
    # Build first: if it fails (e.g. the base image cannot be pulled), the old container keeps running.
    # The container runs as uid 10001 (api/Dockerfile): data/ is handed to it after the old container
    # stopped, so nothing root-owned appears in between. Without it the server cannot read its 0600 files.
    # JF_SECRET must be passed, otherwise stored Jellyfin keys become unreadable.
    # The running image is kept as aniroll-api:prev. If the new server does not answer /api/health
    # (it reads and writes data/) within 20 s, the previous image is started again.
    # --init: Node gets SIGTERM from docker stop and shuts down cleanly. Logs are capped at 3 x 10 MB.
    ssh "$SERVER" "API_DIR='$API_DIR' bash -s" <<'REMOTE'
set -e
start() {
    docker run -d --name aniroll-api --restart unless-stopped --init \
        --log-opt max-size=10m --log-opt max-file=3 \
        -e JF_SECRET="$(cat /root/aniroll-jf.secret)" \
        -v "$API_DIR/data:/app/data" -p 127.0.0.1:3001:3001 "$1" >/dev/null
}
healthy() {
    for _ in $(seq 20); do
        curl -fsS -m 2 http://127.0.0.1:3001/api/health >/dev/null 2>&1 && return 0
        sleep 1
    done
    return 1
}
docker image inspect aniroll-api >/dev/null 2>&1 && docker tag aniroll-api aniroll-api:prev
docker build -q -t aniroll-api "$API_DIR" >/dev/null
docker stop aniroll-api >/dev/null 2>&1 || true
docker rm aniroll-api >/dev/null 2>&1 || true
chown -R 10001:10001 "$API_DIR/data"
start aniroll-api
if ! healthy; then
    echo "new API is not healthy - rolling back"
    docker logs aniroll-api 2>&1 | tail -20
    docker rm -f aniroll-api >/dev/null
    start aniroll-api:prev
    healthy && echo "previous API is back" || echo "previous API does not answer either!"
    exit 1
fi
docker exec aniroll-api sh -c 'echo "node $(node --version), uid $(id -u)"'
docker logs aniroll-api 2>&1 | tail -2
REMOTE
fi

if [ "$WITH_NGINX" -eq 1 ]; then
    step "nginx"
    scp -q deploy/nginx/aniroll.conf "$SERVER:/tmp/aniroll.conf.new"
    ssh "$SERVER" 'set -e
        cp /etc/nginx/sites-enabled/aniroll /root/aniroll-nginx.bak
        cp /tmp/aniroll.conf.new /etc/nginx/sites-enabled/aniroll
        if nginx -t 2>&1; then
            systemctl reload nginx && echo "nginx reloaded"
        else
            cp /root/aniroll-nginx.bak /etc/nginx/sites-enabled/aniroll
            echo "nginx -t failed, previous config restored" >&2
            exit 1
        fi'
fi

step "Verify"
curl -fsS "$SITE/" | grep -q "js/app.js?h=$build" || fail "live index.html does not load build $build"
curl -fsS "$SITE/version.json" | grep -q "\"$build\"" || fail "live version.json is not build $build"
echo "live: build $build"
api_status=$(curl -s -o /dev/null -w '%{http_code}' "$SITE/api/maintenance")
[ "$api_status" = "200" ] || fail "API answered $api_status"
echo "API: 200"
echo; echo "deploy done"
