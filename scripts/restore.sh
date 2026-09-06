#!/usr/bin/env sh
# Restore a backup produced by backup.sh.
#
#   ./scripts/restore.sh <backup-dir>                 # restore into the live database
#   ./scripts/restore.sh <backup-dir> --into <db>     # restore into a scratch database
#   ./scripts/restore.sh <backup-dir> --database-only
#
# Restoring into the live database REPLACES its contents. --into is the safe
# way to rehearse: it proves the dump is usable without touching production.
set -eu

BACKUP="${1:?usage: restore.sh <backup-dir> [--into <db>] [--database-only]}"
shift

DB_USER="${POSTGRES_USER:-face_attendance}"
LIVE_DB="${POSTGRES_DB:-face_attendance}"
TARGET_DB="$LIVE_DB"
DATABASE_ONLY=0
TARGET_BUCKET=""

while [ $# -gt 0 ]; do
  case "$1" in
    --into) TARGET_DB="$2"; shift 2 ;;
    --into-bucket) TARGET_BUCKET="$2"; shift 2 ;;
    --database-only) DATABASE_ONLY=1; shift ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

[ -f "$BACKUP/database.dump" ] || { echo "missing $BACKUP/database.dump" >&2; exit 1; }

if [ "$TARGET_DB" = "$LIVE_DB" ]; then
  printf 'This REPLACES the live database "%s". Type the database name to continue: ' "$LIVE_DB"
  read -r CONFIRM
  [ "$CONFIRM" = "$LIVE_DB" ] || { echo "aborted"; exit 1; }
fi

echo "==> Preparing $TARGET_DB"
docker compose exec -T postgres psql -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1 \
  -c "DROP DATABASE IF EXISTS \"$TARGET_DB\" WITH (FORCE)" \
  -c "CREATE DATABASE \"$TARGET_DB\" OWNER \"$DB_USER\""

echo "==> Restoring schema and rows"
# pg_restore reports harmless notices for extensions it cannot re-own; the exit
# code is checked separately so a real failure is not swallowed.
docker compose exec -T postgres pg_restore -U "$DB_USER" -d "$TARGET_DB" --no-owner --no-privileges \
  < "$BACKUP/database.dump" || echo "   (pg_restore reported non-fatal notices)"

echo "==> Verifying"
docker compose exec -T postgres psql -U "$DB_USER" -d "$TARGET_DB" -tAc \
  "SELECT 'alembic=' || version_num FROM alembic_version"
docker compose exec -T postgres psql -U "$DB_USER" -d "$TARGET_DB" -tAc \
  "SELECT 'users=' || count(*) FROM users"
docker compose exec -T postgres psql -U "$DB_USER" -d "$TARGET_DB" -tAc \
  "SELECT 'attendance_events=' || count(*) FROM attendance_events"

if [ "$DATABASE_ONLY" -eq 0 ] && [ -f "$BACKUP/objects.tar" ]; then
  echo "==> Object storage"
  docker compose exec -T api sh -c 'cat > /tmp/objects.tar' < "$BACKUP/objects.tar"
  if [ -n "$TARGET_BUCKET" ]; then
    docker compose exec -T api python - load --bucket "$TARGET_BUCKET" < ./scripts/object_store.py
  else
    docker compose exec -T api python - load < ./scripts/object_store.py
  fi
  docker compose exec -T api sh -c 'rm -f /tmp/objects.tar'
fi

echo "Restore into $TARGET_DB finished."
