#!/bin/sh
# Nightly backup of the AniRoll backend data (parties, Jellyfin configs, share store,
# client error log). Runs from /etc/cron.d/aniroll-backup, keeps 14 days.
# The Jellyfin key (/root/aniroll-jf.secret) is deliberately NOT included — it stays
# separate from the encrypted data it unlocks.
set -eu

SRC=/opt/aniroll-api/data
DEST=/root/aniroll-backups
KEEP_DAYS=14

mkdir -p "$DEST"
chmod 700 "$DEST"
tar -czf "$DEST/aniroll-data-$(date +%F).tar.gz" -C "$(dirname "$SRC")" "$(basename "$SRC")"
find "$DEST" -name 'aniroll-data-*.tar.gz' -mtime +"$KEEP_DAYS" -delete
