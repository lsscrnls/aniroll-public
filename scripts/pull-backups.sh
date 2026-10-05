#!/usr/bin/env bash
# Off-site copy of the server's nightly backups (scripts/aniroll-backup.sh) onto this machine.
# Incremental: only the days that are not here yet are fetched; nothing here is ever deleted,
# so the copy keeps more than the server's 14 days. From here they go on to OneDrive by hand.
#   scripts/pull-backups.sh [target dir]     default /mnt/games-nvme/aniroll-backups
# Runs daily from the user timer aniroll-backup-pull.timer (see deploy/systemd/).
set -euo pipefail
SERVER="root@89.58.4.162"
SRC=/root/aniroll-backups
DEST="${1:-/mnt/games-nvme/aniroll-backups}"

mountpoint -q /mnt/games-nvme || { echo "/mnt/games-nvme is not mounted" >&2; exit 1; }
mkdir -p "$DEST"
ssh_() { ssh -o BatchMode=yes -o ConnectTimeout=15 "$SERVER" "$@"; }

remote=$(ssh_ "cd $SRC && ls aniroll-data-*.tar.gz 2>/dev/null" || true)
[ -n "$remote" ] || { echo "no backups on the server" >&2; exit 1; }
missing=()
for f in $remote; do [ -s "$DEST/$f" ] || missing+=("$f"); done
if [ ${#missing[@]} -eq 0 ]; then echo "up to date ($(ls "$DEST" | wc -l) days here)"; exit 0; fi

# One connection for all missing days; into a temp dir first, so a broken transfer leaves no half file
tmp=$(mktemp -d "$DEST/.incoming.XXXX")
trap 'rm -rf "$tmp"' EXIT
ssh_ "cd $SRC && tar -cf - ${missing[*]}" | tar -xf - -C "$tmp"
for f in "${missing[@]}"; do
    gzip -t "$tmp/$f" || { echo "damaged: $f" >&2; exit 1; }
    mv "$tmp/$f" "$DEST/$f"
done
echo "fetched ${#missing[@]}: ${missing[*]}"
