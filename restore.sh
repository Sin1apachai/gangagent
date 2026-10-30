#!/bin/sh
# Destructive restore requires the exact destination project name.
set -eu
cd "$(dirname "$0")"
: "${RESTORE_PROJECT:?Set an isolated destination Compose project}"
: "${CONFIRM_RESTORE:?Set CONFIRM_RESTORE to that exact project name}"
[ "$RESTORE_PROJECT" = "$CONFIRM_RESTORE" ] || { echo "Destination confirmation mismatch"; exit 1; }
[ "$RESTORE_PROJECT" != agent-office ] || { echo "Restore into a separate project first, verify, then switch ports"; exit 1; }
database=${OFFICE_DATABASE:-office}
src=${1:?Backup directory required}
(cd "$src" && shasum -a 256 -c SHA256SUMS)
# Reject absolute paths, traversal, and links before any restore.
python3 - "$src/artifacts.tar.gz" <<'CHECK'
import sys,tarfile,pathlib
with tarfile.open(sys.argv[1]) as t:
 for m in t:
  p=pathlib.PurePosixPath(m.name)
  if p.is_absolute() or '..' in p.parts or not p.parts or p.parts[0]!='runs' or not (m.isfile() or m.isdir()):
   raise SystemExit('Unsafe artifact archive entry')
CHECK
# Destination must be provisioned with Compose; wait for startup before restoring.
tries=0
until docker compose -p "$RESTORE_PROJECT" exec -T postgres pg_isready -U office -d "$database" >/dev/null 2>&1; do
  tries=$((tries+1)); [ "$tries" -lt 60 ] || { echo "Destination database not ready"; exit 1; }; sleep 1
done
# Pause destination services before restoring.
docker compose -p "$RESTORE_PROJECT" stop app worker backup >/dev/null
docker compose -p "$RESTORE_PROJECT" exec -T postgres pg_restore -U office -d "$database" --single-transaction --clean --if-exists --no-owner --no-privileges < "$src/office.dump"
if [ -f "$src/post-restore.sql" ]; then
  docker compose -p "$RESTORE_PROJECT" exec -T postgres psql -U office -d "$database" -v ON_ERROR_STOP=1 < "$src/post-restore.sql" >/dev/null
fi
# Old generated roles do not migrate: revoke bindings and reconnect each worker.
docker compose -p "$RESTORE_PROJECT" exec -T postgres psql -U office -d "$database" -q -c "UPDATE worker_bindings SET revoked_at=coalesce(revoked_at,now()); UPDATE office_maintenance SET paused=false WHERE id; UPDATE tasks SET status='interrupted',execution_requested=false,lease_until=NULL,error='Restored backup; review before retrying' WHERE status='running'" >/dev/null
# Use the coordinator image, never give the web app a writable data volume.
docker compose -p "$RESTORE_PROJECT" run --rm -T --no-deps --entrypoint tar worker --acls -C /data -xzf - < "$src/artifacts.tar.gz"
docker compose -p "$RESTORE_PROJECT" up -d app worker backup
printf '%s\n' "Restored into $RESTORE_PROJECT. Check data and reconnect subscription accounts before starting tasks."
