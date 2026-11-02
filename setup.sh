#!/bin/sh
set -eu
cd "$(dirname "$0")"
if [ -f .env ]; then
  echo ".env already exists; leaving credentials unchanged."
else
  umask 077
  python3 - <<'SETUP'
from pathlib import Path
import secrets
Path('.env').write_text('OWNER_EMAIL=owner@office.local\nOWNER_PASSWORD='+secrets.token_hex(16)+'\nPOSTGRES_PASSWORD='+secrets.token_hex(24)+'\nOFFICE_PORT=8088\n')
SETUP
  echo "Created .env with random credentials. Open .env locally to see your login."
fi

# Host ownership is used only by the trusted workspace exporter.
python3 - <<'HOST_OWNER'
from pathlib import Path
import os
root=Path('workspace')
if root.is_symlink():raise SystemExit('workspace must be a real folder, not a symlink')
root.mkdir(exist_ok=True)
p=Path('.env');lines=p.read_text().splitlines()
for key,value in [('OFFICE_HOST_UID',os.getuid()),('OFFICE_HOST_GID',os.getgid())]:
 found=any(line.startswith(key+'=') for line in lines)
 lines=[key+'='+str(value) if line.startswith(key+'=') else line for line in lines]
 if not found:lines.append(key+'='+str(value))
p.write_text('\n'.join(lines)+'\n')
HOST_OWNER
