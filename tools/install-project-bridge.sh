#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
/usr/bin/python3 - <<'PY'
from pathlib import Path
import os,plistlib,secrets,shutil,subprocess
root=Path.cwd();state=Path.home()/'Library/Application Support/Agent Office/Project Bridge';state.mkdir(parents=True,exist_ok=True,mode=0o700)
script=state/'project_bridge.py';shutil.copyfile(root/'tools/project_bridge.py',script);script.chmod(0o700)
env=root/'.env'
if not env.exists():raise SystemExit('Run setup.sh first')
values={line.split('=',1)[0]:line.split('=',1)[1] for line in env.read_text().splitlines() if '=' in line and not line.startswith('#')}
token=values.get('PROJECT_BRIDGE_TOKEN') or secrets.token_hex(32)
if 'PROJECT_BRIDGE_TOKEN' not in values:
 with env.open('a') as f:f.write('\nPROJECT_BRIDGE_TOKEN='+token+'\n')
p=state/'token';p.write_text(token);p.chmod(0o600)
label='local.agent-office.project-bridge'
plist=Path.home()/'Library/LaunchAgents'/f'{label}.plist';plist.parent.mkdir(parents=True,exist_ok=True)
config={'Label':label,'ProgramArguments':['/usr/bin/python3',str(script)],'EnvironmentVariables':{'OFFICE_BRIDGE_STATE':str(state)},'RunAtLoad':True,'KeepAlive':True,'StandardErrorPath':str(state/'bridge-error.log'),'StandardOutPath':str(state/'bridge.log')}
plist.write_bytes(plistlib.dumps(config));plist.chmod(0o600)
subprocess.run(['launchctl','bootout',f'gui/{os.getuid()}/{label}'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
subprocess.run(['launchctl','bootstrap',f'gui/{os.getuid()}',str(plist)],check=True)
print('Local project folder picker is ready. Only folders explicitly selected in the native dialog can be used.')
PY
