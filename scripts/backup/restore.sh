#!/usr/bin/env bash
# Restores an encrypted backup into a database (docs/ops/backup-restore.md). Meant for the monthly restore drill into a
# scratch database and for disaster recovery. It refuses the production database unless told explicitly.
#
#   restore.sh <idrok-db-*.dump.age>
#
#   RESTORE_DATABASE_URL   target (an EMPTY scratch database for the drill)
#   BACKUP_AGE_IDENTITY    file with the age private key (brought in for the restore, removed afterwards)
#   PRODUCTION_DATABASE_URL  optional; when it equals the target, CONFIRM_PRODUCTION_RESTORE=yes is required
set -euo pipefail
umask 077

file="${1:?usage: restore.sh <idrok-db-*.dump.age>}"
: "${RESTORE_DATABASE_URL:?RESTORE_DATABASE_URL is not set}"
: "${BACKUP_AGE_IDENTITY:?BACKUP_AGE_IDENTITY is not set}"

for tool in pg_restore age sha256sum; do
  command -v "$tool" >/dev/null || { echo "missing tool: $tool" >&2; exit 1; }
done

if [[ -n "${PRODUCTION_DATABASE_URL:-}" && "$RESTORE_DATABASE_URL" == "$PRODUCTION_DATABASE_URL" ]]; then
  if [[ "${CONFIRM_PRODUCTION_RESTORE:-}" != "yes" ]]; then
    echo "refusing to restore over the production database (set CONFIRM_PRODUCTION_RESTORE=yes)" >&2
    exit 1
  fi
fi

if [[ -f "$file.sha256" ]]; then
  (cd "$(dirname "$file")" && sha256sum --check --status "$(basename "$file").sha256") \
    || { echo "checksum mismatch: $file" >&2; exit 1; }
fi

age --decrypt --identity "$BACKUP_AGE_IDENTITY" "$file" \
  | pg_restore --no-owner --no-privileges --exit-on-error --dbname="$RESTORE_DATABASE_URL"
echo "restored $(basename "$file")"
echo "next: psql \"\$RESTORE_DATABASE_URL\" -f scripts/backup/verify.sql   (compare with the live counts)"
