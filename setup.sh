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
