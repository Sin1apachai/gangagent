import os,sys,json,subprocess,time,urllib.parse
assert os.environ.get('OFFICE_TEST_TARGET')=='disposable_security', 'Explicit disposable-security opt-in required'
os.environ.setdefault('BASE_URL','http://127.0.0.1:8099')
sys.path.insert(0,str(__import__('pathlib').Path(__file__).parent))
from test_api import client,call
probe_email='worker-'+__import__('uuid').uuid4().hex+'@office.local'
c=client();assert call(c,'/auth/login',{'email':os.environ['OWNER_EMAIL'],'password':os.environ['OWNER_PASSWORD']})[0]==200
status,u=call(c,'/admin/users',{'name':'Private Worker Tester','email':probe_email,'password':'private-test-password-12345'});assert status==200
member=client();assert call(member,'/auth/login',{'email':probe_email,'password':'private-test-password-12345'})[0]==200
wid=call(member,'/workspaces',{'name':'Private worker verification'})[1]['id']
foreign=call(c,'/workspaces',{'name':'Foreign private verification'})[1]['id']
assert call(c,f'/workspaces/{foreign}/tasks',{'title':'Private foreign task','description':'Must not be visible','provider':'codex'})[0]==200
for cc,ww,title in [(c,foreign,'FORBIDDEN PRIVATE NOTE'),(member,wid,'MY PRIVATE NOTE')]:
 assert call(cc,f'/workspaces/{ww}/knowledge',{'title':title,'content':'Verified source','source':'security test','verified':True})[0]==200
status,b=call(member,'/personal-workers',{'label':'Scoped acceptance worker'});assert status==200
compose=b['compose'];env=compose['services']['worker']['environment'];uri=urllib.parse.urlsplit(env['DATABASE_URL']);role=uri.username;pw=uri.password
prefix=os.environ.get('OFFICE_TEST_PROJECT','agent-office-release-preview')
pg=prefix+'-postgres-1';redis=prefix+'-redis-1'
def psql(sql):
 r=subprocess.run(['docker','exec','-e','PGPASSWORD='+pw,pg,'psql','-h','127.0.0.1','-U',role,'-d','office_test','-At','-v','ON_ERROR_STOP=1','-c',sql],capture_output=True,text=True)
 return r.returncode,r.stdout.strip(),r.stderr
assert psql('SELECT count(*) FROM knowledge')[1]=='1'
assert psql("SELECT count(*) FROM knowledge WHERE title='FORBIDDEN PRIVATE NOTE'")[1]=='0'
for table in ('skills','skill_versions','agent_skills','workflows','workflow_versions','workflow_launches'):
 assert psql('SELECT count(*) FROM '+table)[0]!=0
assert psql('SELECT password_hash FROM users')[0]!=0
assert psql('SET ROLE office')[0]!=0
assert psql('UPDATE memberships SET role=\'owner\'')[0]!=0
assert psql('UPDATE office_maintenance SET paused=false')[0]!=0
assert psql('SELECT count(*) FROM users')[1]=='1'
print('PASS PostgreSQL: owner-scoped knowledge/users; password, role escalation, membership and maintenance writes denied',flush=True)
uid=u['id']
subprocess.run(['docker','exec',redis,'redis-cli','SET',f'provider-login-input:{uid}:probe','own'],capture_output=True,check=True)
subprocess.run(['docker','exec',redis,'redis-cli','SET','provider-login-input:other:probe','foreign'],capture_output=True,check=True)
def rcli(*args):
 r=subprocess.run(['docker','exec',redis,'redis-cli','--no-auth-warning','--user',role,'--pass',pw,*args],capture_output=True,text=True)
 return (r.stdout+r.stderr).strip()
assert rcli('GETDEL',f'provider-login-input:{uid}:probe')=='own'
assert 'NOPERM' in rcli('GETDEL','provider-login-input:other:probe')
assert 'NOPERM' in rcli('SET',f'provider-login-input:{uid}:probe','x')
assert 'NOPERM' in rcli('ACL','LIST')
print('PASS Redis: own one-time mailbox only; foreign mailbox and administration denied',flush=True)
# First boot uses the real CLI worker without credentials; no task is started.
path='/private/tmp/office-personal-security.compose.json'
with open(path,'w') as f:json.dump(compose,f)
os.chmod(path,0o600)
cmd=['docker','compose','-f',path]
try:
 subprocess.run(cmd+['up','-d'],capture_output=True,check=True)
 for _ in range(60):
  info=call(member,'/connections')[1]
  if any(w['online'] for w in info['workers']):break
  time.sleep(1)
 else:raise AssertionError('Scoped worker did not register')
 container=subprocess.run(cmd+['ps','-q','worker'],capture_output=True,text=True,check=True).stdout.strip()
 identity=subprocess.run(['docker','exec','--user',env['MODEL_UID']+':'+env['MODEL_UID'],container,'node','-e','console.log(require("os").userInfo().username)'],capture_output=True,text=True)
 assert identity.returncode==0 and identity.stdout.strip()=='office-model-'+env['MODEL_UID']
 print('PASS Personal model UID resolves a real Linux account; both official CLIs heartbeat without credentials',flush=True)
 env.update(WORKER_MODE='fixture',ALLOW_TEST_WORKER='1')
 with open(path,'w') as f:json.dump(compose,f)
 subprocess.run(cmd+['up','-d'],capture_output=True,check=True)
 for _ in range(60):
  if any(w['online'] and w['mode']=='fixture' for w in call(member,'/connections')[1]['workers']):break
  time.sleep(1)
 else:raise AssertionError('Fixture worker unavailable')
 assert call(member,'/connections/codex' ,{'enabled':True,'billing_acknowledged':True},'PUT')[0]==200
 aid=call(member,f'/workspaces/{wid}/agents',{'name':'Personal Skill Agent','role':'Builder','instructions':'Follow assigned skills','provider':'codex','enabled':True,'x':4,'y':4})[1]['id']
 sid=call(member,f'/workspaces/{wid}/skills',{'title':'Personal playbook','instructions':'PERSONAL_SKILL_CONTEXT'})[1]['id']
 assert call(member,f'/workspaces/{wid}/agents/{aid}/organization',{'version':0,'manager_id':None,'skills':[{'skill_id':sid,'pinned_version':0}]},'PUT')[0]==200
 tid=call(member,f'/workspaces/{wid}/tasks' ,{'title':'Personal worker actual acceptance','description':'Return fixture output','provider':'codex','agent_id':aid})[1]['id']
 taskpath=f'/workspaces/{wid}/tasks/{tid}'
 assert call(member,taskpath+'/run',{'billing_acknowledged':True})[0]==200
 for _ in range(80):
  status,d=call(member,taskpath)
  if d['task']['status']=='review':break
  time.sleep(.3)
 else:
  logs=subprocess.run(cmd+['logs','--tail','15'],capture_output=True,text=True).stdout
  print(logs.replace(pw,'[REDACTED]'));raise AssertionError('Personal task did not finish: '+d['task']['status'])
 assert 'PERSONAL_SKILL_CONTEXT' in d['task']['result']
 assert d['task']['execution_context']['skills'][0]['version']==0
 assert d['artifacts'];url=d['artifacts'][0]
 # The web app must read a file created under the personal model UID.
 runid=d['task']['current_run_id']
 result=subprocess.run(['docker','exec',prefix+'-app-1','sh','-c',f'test -r /data/runs/{runid}/result.txt'],capture_output=True)
 # Determine metadata names rather than assuming a fixture filename.
 names=[x['name'] for x in d['artifacts']]
 result=subprocess.run(['docker','exec',prefix+'-app-1','test','-r',f'/data/runs/{runid}/'+names[0]],capture_output=True)
 assert result.returncode==0
 assert psql(f"SELECT count(*) FROM tasks WHERE workspace_id='{foreign}'")[1]=='0'
 print('PASS Personal worker: frozen Skill executed once with separate UID; library tables denied; web app reads artifact through ACL',flush=True)
 assert call(member,'/personal-workers/'+b['id'],method='DELETE')[0]==200
 assert psql('SELECT 1')[0]!=0
 assert ('WRONGPASS' in rcli('PING') or 'NOAUTH' in rcli('PING'))
 print('PASS Revoke: PostgreSQL and Redis credentials rejected',flush=True)
finally:
 subprocess.run(cmd+['down','--volumes'],capture_output=True)
 os.unlink(path)
