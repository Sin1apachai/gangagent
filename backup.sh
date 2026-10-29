#!/bin/sh
# Run from the trusted Docker host. No AI credentials are exported.
set -eu
cd "$(dirname "$0")"
umask 077
database=${OFFICE_DATABASE:-office}
stamp=$(date +%Y%m%d-%H%M%S)
dest="backups/office-$stamp"
mkdir -p "$dest"
resume(){ docker compose exec -T postgres psql -U office -d "$database" -q -c "UPDATE office_maintenance SET paused=false WHERE id" >/dev/null; }
trap resume EXIT INT TERM
docker compose exec -T postgres psql -U office -d "$database" -q -c "UPDATE office_maintenance SET paused=true WHERE id" >/dev/null
# Explicitly wait for active model jobs; never interrupt or replay them.
while [ "$(docker compose exec -T postgres psql -U office -d "$database" -Atc "SELECT count(*) FROM tasks WHERE status='running' AND lease_until>now()")" != 0 ]; do sleep 2; done
docker compose exec -T postgres pg_dump -U office -d "$database" -Fc > "$dest/office.dump"
# NUL-delimited registered paths, no model-created unregistered files or symlinks.
docker compose exec -T postgres psql -U office -d "$database" -0Atc "SELECT 'runs/'||run_id||'/'||name FROM artifacts ORDER BY run_id,name" > "$dest/artifact-paths.nul"
python3 - "$dest/artifact-paths.nul" <<'PATHS'
import sys,pathlib
p=pathlib.Path(sys.argv[1]);files=[x.decode('utf-8') for x in p.read_bytes().split(b'\0') if x];dirs=set()
for name in files:
 path=pathlib.PurePosixPath(name)
 if path.is_absolute() or '..' in path.parts or len(path.parts)<3 or path.parts[0]!='runs':raise SystemExit('Unsafe registered artifact path')
 for parent in path.parents:
  if len(parent.parts)>=2:dirs.add(str(parent))
p.write_bytes(b''.join(x.encode('utf-8')+b'\0' for x in sorted(dirs,key=lambda x:(x.count('/'),x))+files))
PATHS
docker compose exec -T worker tar --acls --no-recursion --null --verbatim-files-from -C /data -T - -czf - < "$dest/artifact-paths.nul" > "$dest/artifacts.tar.gz"
rm "$dest/artifact-paths.nul"
(cd "$dest" && shasum -a 256 office.dump artifacts.tar.gz > SHA256SUMS)
printf '%s\n' "Backup complete: $dest (private; subscriptions must be reconnected after moving)"
