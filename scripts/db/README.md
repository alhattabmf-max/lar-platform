# Database Backup / Restore

Three scripts, none of which ever print a connection string or
password, and none of which write backup files anywhere that gets
committed or archived (`backups/` is excluded via `.gitignore` and
`.dockerignore`, and the ZIP archiver's allowlist never includes it).

## `backup-db.sh`

```bash
DATABASE_URL=postgresql://platform:platform@localhost:5432/platform_dev?schema=public \
  scripts/db/backup-db.sh [output-dir]
```

- Uses `pg_dump -Fc` (custom format — required for `pg_restore`).
- Output file: `<output-dir>/<dbname>_<UTC timestamp>.dump` (default
  output dir: `./backups`).
- Writes a `<file>.sha256` checksum alongside it.
- Refuses to overwrite an existing backup file.
- The password is passed to `pg_dump` via the `PGPASSWORD`
  environment variable, never as a CLI argument or in a printed URL.

## `verify-backup.sh`

```bash
scripts/db/verify-backup.sh backups/platform_dev_20260101T000000Z.dump
```

Verifies the `.sha256` checksum next to the given backup file
matches its actual content. `restore-db.sh` runs this automatically
before touching any database.

## `restore-db.sh`

```bash
DATABASE_URL=postgresql://platform:platform@localhost:5432/postgres?schema=public \
  scripts/db/restore-db.sh <backup-file> <new-db-name>
```

- `DATABASE_URL` here is an **admin** connection (host/port/user
  only matter — point it at the `postgres` maintenance database).
- Restores **only into a database that does not yet exist**. If
  `<new-db-name>` already exists, the script **always** refuses and
  exits non-zero — there is no override flag, no force option, and
  no code path anywhere that drops or overwrites an existing
  database. This is deliberate: an easy override next to a
  destructive operation is exactly the kind of thing that empties a
  database by accident. To restore into a name that's already taken,
  drop or rename that database yourself, outside this script.
- After restore, prints:
  - the row count of `_prisma_migrations` in the restored database,
  - a `SELECT 1` smoke query result.
- To confirm the restored database's migration state matches
  `prisma/migrations` exactly, run (from `apps/api`):
  ```bash
  DATABASE_URL=<restored-db-connection-string> pnpm exec prisma migrate status
  ```

## What is intentionally NOT here

- No automatic scheduling (cron/systemd timer) — this is an
  operator-invoked tool for this phase, not a managed backup
  service.
- No cloud storage upload — backups stay local to wherever the
  operator points `output-dir`; shipping them off-box is a
  deployment-environment concern, not this script's.
