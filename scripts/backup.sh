#!/usr/bin/env sh
# Full backup: Postgres dump + private object bucket, into one timestamped folder.
#
#   ./scripts/backup.sh [destination-dir]
#
# Run from the repository root with the stack up. The output contains biometric
# images and password hashes — store it encrypted and off this machine.
set -eu

DESTINATION="${1:-./backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$DESTINATION/$STAMP"
mkdir -p "$OUT"

DB_USER="${POSTGRES_USER:-face_attendance}"
DB_NAME="${POSTGRES_DB:-face_attendance}"

echo "==> Postgres dump"
# Custom format: compressed and restorable table-by-table with pg_restore.
docker compose exec -T postgres pg_dump -U "$DB_USER" -d "$DB_NAME" -Fc > "$OUT/database.dump"

echo "==> Schema version"
docker compose exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -tAc \
  "SELECT version_num FROM alembic_version" > "$OUT/alembic_version.txt"

echo "==> Object storage"
# compose exec has no volume flag, so the helper is piped in on stdin. Paths stay
# inside sh -c strings so Git Bash on Windows does not rewrite them.
docker compose exec -T api python - dump < ./scripts/object_store.py >/dev/null
docker compose exec -T api sh -c 'cat /tmp/objects.tar' > "$OUT/objects.tar"
docker compose exec -T api sh -c 'rm -f /tmp/objects.tar'

echo "==> Manifest"
{
  echo "created_at=$STAMP"
  echo "alembic_version=$(cat "$OUT/alembic_version.txt")"
  echo "database_bytes=$(wc -c < "$OUT/database.dump")"
  echo "objects_bytes=$(wc -c < "$OUT/objects.tar")"
} > "$OUT/manifest.txt"

echo "Backup written to $OUT"
cat "$OUT/manifest.txt"
