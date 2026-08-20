#!/usr/bin/env bash
# ============================================================
# restore-db.sh — Restore a custom-format (-Fc) pg_dump backup.
#
# Usage:
#   DATABASE_URL=postgresql://user:pass@host:port/postgres \
#     scripts/db/restore-db.sh <backup-file> <new-db-name>
#
# - DATABASE_URL here is the ADMIN connection (used to create the
#   target database and to run `pg_restore`) — typically pointed
#   at the "postgres" maintenance database; host/port/user matter,
#   the dbname in the URL itself is ignored.
# - Restores ONLY into a database that does NOT yet exist. If
#   <new-db-name> already exists, this script ALWAYS refuses and
#   exits non-zero — there is no override flag, no force option,
#   and no code path that drops or overwrites an existing database.
#   To restore into a fresh copy of an existing name, drop or
#   rename that database yourself, deliberately, outside this
#   script — restore-db.sh will not do it for you.
# - Verifies the backup's SHA-256 checksum before touching any
#   database.
# - After restore: reports the actual row count of
#   _prisma_migrations, and runs a smoke query (SELECT 1) —
#   printed to stdout for the operator to review.
# - Never logs the connection string or password.
# ============================================================
set -euo pipefail

BACKUP_FILE="${1:-}"
NEW_DB_NAME="${2:-}"

if [ -z "$BACKUP_FILE" ] || [ -z "$NEW_DB_NAME" ]; then
  echo "Usage: $0 <backup-file> <new-db-name>" >&2
  exit 1
fi
if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL must be set (admin connection; not printed here for safety)." >&2
  exit 1
fi
if [ ! -f "$BACKUP_FILE" ]; then
  echo "ERROR: backup file not found: $BACKUP_FILE" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "Verifying backup checksum before restoring..."
"$SCRIPT_DIR/verify-backup.sh" "$BACKUP_FILE"

url="$DATABASE_URL"
url="${url#postgresql://}"
url="${url#postgres://}"
creds="${url%%@*}"
rest="${url#*@}"
DB_USER="${creds%%:*}"
DB_PASSWORD="${creds#*:}"
hostport_db="${rest%%\?*}"
hostport="${hostport_db%%/*}"
DB_HOST="${hostport%%:*}"
DB_PORT="${hostport#*:}"

export PGPASSWORD="$DB_PASSWORD"

EXISTS="$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '$NEW_DB_NAME'")"

if [ "$EXISTS" = "1" ]; then
  echo "ERROR: database \"$NEW_DB_NAME\" already exists. restore-db.sh only ever restores into a NEW database and will not overwrite an existing one — there is no override for this." >&2
  unset PGPASSWORD
  exit 1
fi

echo "Creating database \"$NEW_DB_NAME\"..."
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d postgres -c "CREATE DATABASE \"$NEW_DB_NAME\" OWNER $DB_USER" > /dev/null

echo "Restoring backup into \"$NEW_DB_NAME\"..."
pg_restore -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$NEW_DB_NAME" --no-owner "$BACKUP_FILE"

echo ""
echo "=== Post-restore verification ==="

MIGRATION_COUNT="$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$NEW_DB_NAME" -tAc "SELECT COUNT(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL" 2>/dev/null || echo "N/A (table not found)")"
echo "Applied migrations in restored DB: $MIGRATION_COUNT"

SMOKE_QUERY_RESULT="$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$NEW_DB_NAME" -tAc "SELECT 1")"
if [ "$SMOKE_QUERY_RESULT" = "1" ]; then
  echo "Smoke query (SELECT 1): OK"
else
  echo "Smoke query (SELECT 1): UNEXPECTED RESULT: $SMOKE_QUERY_RESULT" >&2
fi

unset PGPASSWORD

echo ""
echo "To check full Prisma migrate status against the restored database, run:"
echo "  DATABASE_URL=<restored-db-connection-string> pnpm --filter api exec prisma migrate status"
echo "(connection details intentionally not echoed by this script)"
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d postgres -c "CREATE DATABASE \"$NEW_DB_NAME\" OWNER $DB_USER" > /dev/null

echo "Restoring backup into \"$NEW_DB_NAME\"..."
pg_restore -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$NEW_DB_NAME" --no-owner "$BACKUP_FILE"

echo ""
echo "=== Post-restore verification ==="

MIGRATION_COUNT="$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$NEW_DB_NAME" -tAc "SELECT COUNT(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL" 2>/dev/null || echo "N/A (table not found)")"
echo "Applied migrations in restored DB: $MIGRATION_COUNT"

SMOKE_QUERY_RESULT="$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$NEW_DB_NAME" -tAc "SELECT 1")"
if [ "$SMOKE_QUERY_RESULT" = "1" ]; then
  echo "Smoke query (SELECT 1): OK"
else
  echo "Smoke query (SELECT 1): UNEXPECTED RESULT: $SMOKE_QUERY_RESULT" >&2
fi

unset PGPASSWORD

echo ""
echo "To check full Prisma migrate status against the restored database, run:"
echo "  DATABASE_URL=<restored-db-connection-string> pnpm --filter api exec prisma migrate status"
echo "(connection details intentionally not echoed by this script)"
