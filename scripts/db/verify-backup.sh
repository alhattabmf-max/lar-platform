#!/usr/bin/env bash
# ============================================================
# verify-backup.sh — Verify a backup's SHA-256 checksum matches
# its recorded .sha256 file.
#
# Usage:
#   scripts/db/verify-backup.sh backups/platform_dev_20260101T000000Z.dump
# ============================================================
set -euo pipefail

FILEPATH="${1:-}"
if [ -z "$FILEPATH" ]; then
  echo "Usage: $0 <path-to-backup-file>" >&2
  exit 1
fi
if [ ! -f "$FILEPATH" ]; then
  echo "ERROR: backup file not found: $FILEPATH" >&2
  exit 1
fi
CHECKSUM_FILE="${FILEPATH}.sha256"
if [ ! -f "$CHECKSUM_FILE" ]; then
  echo "ERROR: checksum file not found: $CHECKSUM_FILE" >&2
  exit 1
fi

DIR="$(dirname "$FILEPATH")"

if (cd "$DIR" && sha256sum -c "$(basename "$CHECKSUM_FILE")" --quiet); then
  echo "OK: $(basename "$FILEPATH") checksum verified."
else
  echo "FAILED: $(basename "$FILEPATH") checksum does NOT match $CHECKSUM_FILE — backup may be corrupted or tampered with." >&2
  exit 1
fi
