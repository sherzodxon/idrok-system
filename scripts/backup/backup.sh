#!/usr/bin/env bash
# Encrypted PostgreSQL backup (docs/ops/backup-restore.md). Run on the VPS from cron, as a user that can read the env
# file. The database URL is never printed (it holds the password).
#
#   BACKUP_DATABASE_URL   direct connection (not the pooler), read-only role recommended
#   BACKUP_DIR            where the encrypted dumps are kept, e.g. /var/backups/idrok
#   BACKUP_AGE_RECIPIENT  age public key ("age1..."); the private key is kept OFF this server
#   BACKUP_KEEP_DAYS      local retention (default 14)
#   BACKUP_REMOTE         optional rclone destination for an off-site copy, e.g. "b2:idrok-backups/db"
#   BACKUP_FILES_DIR      optional: the local file storage (uploads, encrypted face photos) to archive as well
set -euo pipefail
umask 077

: "${BACKUP_DATABASE_URL:?BACKUP_DATABASE_URL is not set}"
: "${BACKUP_DIR:?BACKUP_DIR is not set}"
: "${BACKUP_AGE_RECIPIENT:?BACKUP_AGE_RECIPIENT is not set}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"

for tool in pg_dump age sha256sum; do
  command -v "$tool" >/dev/null || { echo "missing tool: $tool" >&2; exit 1; }
done

mkdir -p "$BACKUP_DIR"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
db_file="$BACKUP_DIR/idrok-db-$stamp.dump.age"
tmp="$db_file.partial"

# Custom format: compressed, restorable table by table; no owners or grants (the target role may differ).
pg_dump --format=custom --no-owner --no-privileges --dbname="$BACKUP_DATABASE_URL" \
  | age --encrypt --recipient "$BACKUP_AGE_RECIPIENT" --output "$tmp"
mv "$tmp" "$db_file"
sha256sum "$db_file" > "$db_file.sha256"
echo "database backup: $(basename "$db_file") ($(du -h "$db_file" | cut -f1))"

if [[ -n "${BACKUP_FILES_DIR:-}" ]]; then
  files_file="$BACKUP_DIR/idrok-files-$stamp.tar.age"
  tar --create --gzip --directory "$BACKUP_FILES_DIR" . \
    | age --encrypt --recipient "$BACKUP_AGE_RECIPIENT" --output "$files_file.partial"
  mv "$files_file.partial" "$files_file"
  sha256sum "$files_file" > "$files_file.sha256"
  echo "files backup: $(basename "$files_file")"
fi

if [[ -n "${BACKUP_REMOTE:-}" ]]; then
  command -v rclone >/dev/null || { echo "missing tool: rclone (BACKUP_REMOTE is set)" >&2; exit 1; }
  rclone copy --include "idrok-*-$stamp.*" "$BACKUP_DIR" "$BACKUP_REMOTE"
  echo "copied off-site: $BACKUP_REMOTE"
fi

# Local retention only; the off-site copy keeps its own (bucket lifecycle rule).
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'idrok-*' -mtime +"$KEEP_DAYS" -print -delete
