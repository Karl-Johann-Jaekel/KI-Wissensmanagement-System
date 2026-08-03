#!/usr/bin/env bash
# Nightly-Backup (PLAN Phase 10): pg_dump im Custom-Format + 14-Tage-Rotation.
# Host-Cron auf dem VPS (03:00):
#   0 3 * * * cd /opt/kwms && ./scripts/backup.sh >> backups/backup.log 2>&1
# Zusätzlich provider-seitige Volume-Snapshots aktivieren (z. B. Hetzner).
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"
POSTGRES_USER="${POSTGRES_USER:-kwms}"
POSTGRES_DB="${POSTGRES_DB:-kwms}"

mkdir -p "$BACKUP_DIR"
STAMP=$(date +%F)
TARGET="$BACKUP_DIR/kwms-$STAMP.dump"

docker compose exec -T postgres pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB" > "$TARGET"
echo "$(date -Is) backup written: $TARGET ($(du -h "$TARGET" | cut -f1))"

# Rotation: alles älter als KEEP_DAYS löschen.
find "$BACKUP_DIR" -name 'kwms-*.dump' -mtime "+$KEEP_DAYS" -delete
