#!/usr/bin/env bash
# ============================================================
# backup-db.sh — Create a custom-format (-Fc) pg_dump backup.
#
# Usage:
#   DATABASE_URL=postgresql://user:pass@host:port/dbname \
#     scripts/db/backup-db.sh [output-dir]
#
# - Reads connection details from DATABASE_URL (never printed,
#   never passed as a bare command-line argument — the password
#   is exported only as PGPASSWORD, which does not appear in
#   `ps` output the way a CLI argument would).
# - Output file name: <dbname>_<UTC timestamp>.dump
# - Refuses to overwrite an existing backup file.
# - Writes a matching <file>.sha256 checksum next to the backup.
# - Never logs the connection string, password, or full pg_dump
#   command line (which would embed the values above).
#
# Output directory defaults to ./backups (gitignored — backups
# are never committed or archived; see .gitignore).
# ============================================================
set -euo pipefail

OUTPUT_DIR="${1:-./backups}"

if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL must be set (not printed here for safety)." >&2
  exit 1
fi

# Parse postgresql://user:pass@host:port/dbname?params — extracted
# into separate variables so pg_dump receives them via -h/-p/-U/-d
# flags and PGPASSWORD, never as a single URL that could appear in
# process listings or shell history in full.
url="$DATABASE_URL"
url="${url#postgresql://}"
url="${url#postgres://}"
creds="${url%%@*}"
rest="${url#*@}"
DB_USER="${creds%%:*}"
DB_PASSWORD="${creds#*:}"
hostport_db="${rest%%\?*}"
hostport="${hostport_db%%/*}"
DB_NAME="${hostport_db#*/}"
DB_HOST="${hostport%%:*}"
DB_PORT="${hostport#*:}"

if [ -z "$DB_NAME" ] || [ -z "$DB_HOST" ] || [ -z "$DB_USER" ]; then
  echo "ERROR: could not parse DATABASE_URL into host/user/dbname." >&2
  exit 1
fi

mkdir -p "$OUTPUT_DIR"

TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILENAME="${DB_NAME}_${TIMESTAMP}.dump"
FILEPATH="${OUTPUT_DIR%/}/${FILENAME}"

if [ -e "$FILEPATH" ]; then
  echo "ERROR: backup file already exists, refusing to overwrite: $FILEPATH" >&2
  exit 1
fi

echo "Starting backup of database \"$DB_NAME\" (host=$DB_HOST, port=$DB_PORT)..."

export PGPASSWORD="$DB_PASSWORD"
pg_dump -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -Fc -f "$FILEPATH"
unset PGPASSWORD

SHA256="$(sha256sum "$FILEPATH" | awk '{print $1}')"
echo "$SHA256  $FILENAME" > "${FILEPATH}.sha256"

SIZE_BYTES="$(stat -c%s "$FILEPATH" 2>/dev/null || stat -f%z "$FILEPATH")"

echo "Backup complete."
echo "  File:   $FILEPATH"
echo "  Size:   ${SIZE_BYTES} bytes"
echo "  SHA256: $SHA256"
echo "  (checksum file: ${FILEPATH}.sha256)"
