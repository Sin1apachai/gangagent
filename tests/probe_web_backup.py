"""Opt-in Docker recovery proof; hard-scoped to the disposable backup preview."""
import os,sys,time,uuid,json,io,tarfile,hashlib,subprocess
from test_api import call,client,BASE
assert os.environ.get('OFFICE_TEST_TARGET')=='isolated_preview'
assert BASE=='http://127.0.0.1:8091'
PROJECT='agent-office-backup-preview';RESTORE_DB='office_backup_restore_proof';VOLUME=PROJECT+'_restored-proof'
COMPOSE=['docker','compose','-p',PROJECT,'-f','compose.yaml','-f','compose.test.yaml','-f','/private/tmp/office-backup-preview.yaml']
def run(args,data=None):
 p=subprocess.run(args,input=data,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 assert p.returncode==0,'Isolated probe command failed: '+p.stderr.decode(errors='replace')[:300]
 return p.stdout
def sql(query,db='office_test'):
 return run(COMPOSE+['exec','-T','postgres','psql','-U','office','-d',db,'-v','ON_ERROR_STOP=1','-Atc',query]).decode().strip()
def ok(r):assert r[0]==200,r;return r[1]
c=client()
for _ in range(60):
 try:ok(call(c,'/auth/login',{'email':'preview@office.local','password':'local-preview-only-2026'}));break
 except Exception:time.sleep(.5)
else:raise RuntimeError('Preview login unavailable')
for _ in range(60):
 s=ok(call(c,'/admin/backups'));info=ok(call(c,'/connections'))
 if s['online'] and any(w['online'] and w['mode']=='fixture' for w in info['workers']):break
 time.sleep(.5)
else:raise RuntimeError('Preview backup/fixture service unavailable')
assert all(w['mode']=='fixture' for w in info['workers'])
for provider in ('codex','claude'):ok(call(c,'/connections/'+provider,{'enabled':True,'billing_acknowledged':True},'PUT'))
wid=ok(call(c,'/workspaces',{'name':'Web backup restore proof'}))['id'];base='/workspaces/'+wid
marker='RESTORE_PROOF_'+uuid.uuid4().hex
kid=ok(call(c,base+'/knowledge',{'title':'Restore proof knowledge','content':marker,'source':'Synthetic isolated recovery test','verified':True}))['id']
aid=ok(call(c,base+'/agents',{'name':'Backup proof agent','role':'Verifier','instructions':'Keep the proof marker','provider':'codex','enabled':True,'birth_date':'2000-03-21'}))['id']
sid=ok(call(c,base+'/skills',{'title':'Restore proof skill','description':'Synthetic','instructions':'Retain evidence','input_contract':'Brief','output_contract':'Proof','acceptance_criteria':'Marker intact'}))['id']
wfid=ok(call(c,base+'/workflows',{'title':'Restore proof workflow','description':'Synthetic','steps':[{'title':'Proof','description':'Retain source evidence','agent_id':aid,'depends_on':[],'required_files':['result.md']}]}))['id']
tid=ok(call(c,base+'/tasks',{'title':'Restore proof task','description':marker,'provider':'codex','agent_id':aid}))['id'];path=base+'/tasks/'+tid
ok(call(c,path+'/attachments',{'name':'proof.txt','data':list(marker.encode())}));ok(call(c,path+'/run',{'billing_acknowledged':True}))
for _ in range(150):
 d=ok(call(c,path))
 if d['task']['status']=='review':break
 time.sleep(.1)
else:raise RuntimeError('Fixture did not finish')
runid=d['runs'][0]['id'];artifact=next(f for f in d['artifacts'] if f['run_id']==runid and f['name']=='result.md')
with c.open(BASE+'/api'+path+'/artifacts/'+artifact['id']) as r:original=r.read()
# Only a synthetic volume is touched: verify unregistered files stay out and ACLs survive.
source=PROJECT+'_runs-data'
run(['docker','run','--rm','--label','com.docker.compose.project='+PROJECT,'--label','com.docker.compose.service=restore-proof','--entrypoint','/bin/sh','-v',source+':/data','agent-office-worker:latest','-c',f'echo NOT_REGISTERED > /data/runs/{runid}/unregistered.txt'])
for target,permission in [(f'/data/runs/{runid}','rx'),(f'/data/runs/{runid}/result.md','r')]:
 run(['docker','run','--rm','--label','com.docker.compose.project='+PROJECT,'--label','com.docker.compose.service=restore-proof','--entrypoint','setfacl','-v',source+':/data','agent-office-worker:latest','-m','u:20001:'+permission,target])
def backup():return ok(call(c,'/admin/backups',{'acknowledged':True}))['id']
def wait_job(bid,status):
 for _ in range(200):
  j=next(x for x in ok(call(c,'/admin/backups'))['jobs'] if x['id']==bid)
  if j['status']==status:return j
  if j['status']=='failed' and status!='failed':raise AssertionError(j)
  time.sleep(.1)
 raise RuntimeError('Backup did not reach '+status)
bid=backup();j=wait_job(bid,'ready')
with c.open(BASE+'/api/admin/backups/'+bid+'/download') as response:
 raw=response.read();assert response.headers['X-Backup-Sha256']==hashlib.sha256(raw).hexdigest()
with tarfile.open(fileobj=io.BytesIO(raw)) as t:
 assert set(t.getnames())=={'office.dump','artifacts.tar.gz','manifest.json','SHA256SUMS','post-restore.sql'}
 assert all(m.isfile() for m in t)
 parts={m.name:t.extractfile(m).read() for m in t}
for line in parts['SHA256SUMS'].decode().splitlines():
 digest,name=line.split('  ',1);assert hashlib.sha256(parts[name]).hexdigest()==digest
with tarfile.open(fileobj=io.BytesIO(parts['artifacts.tar.gz'])) as t:
 assert all((m.isfile() or m.isdir()) and m.name.startswith('runs/') and '..' not in m.name.split('/') for m in t)
 assert all(not m.name.endswith('/unregistered.txt') for m in t)
run(COMPOSE+['exec','-T','postgres','dropdb','-U','office','--if-exists',RESTORE_DB])
run(COMPOSE+['exec','-T','postgres','createdb','-U','office',RESTORE_DB])
run(COMPOSE+['exec','-T','postgres','pg_restore','-U','office','-d',RESTORE_DB,'--single-transaction','--no-owner','--no-privileges'],parts['office.dump'])
run(COMPOSE+['exec','-T','postgres','psql','-U','office','-d',RESTORE_DB,'-v','ON_ERROR_STOP=1'],parts['post-restore.sql'])
assert sql(f"SELECT content FROM knowledge WHERE id='{kid}'",RESTORE_DB)==marker
assert sql(f"SELECT birth_date FROM agents WHERE id='{aid}'",RESTORE_DB)=='2000-03-21'
assert sql(f"SELECT personality->>'zodiac_id' FROM agents WHERE id='{aid}'",RESTORE_DB)=='aries'
assert sql(f"SELECT count(*) FROM skills WHERE id='{sid}'",RESTORE_DB)=='1'
assert sql(f"SELECT count(*) FROM workflows WHERE id='{wfid}'",RESTORE_DB)=='1'
assert sql('SELECT count(*) FROM master_data',RESTORE_DB)=='39'
assert sql(f"SELECT convert_from(data,'UTF8') FROM task_attachments WHERE task_id='{tid}'",RESTORE_DB)==marker
for table in ('sessions','workers','worker_bindings','provider_logins','backup_jobs','backup_service'):assert sql('SELECT count(*) FROM '+table,RESTORE_DB)=='0',table
assert sql('SELECT paused FROM office_maintenance',RESTORE_DB)=='f'
assert sql('SELECT count(*) FROM tasks WHERE execution_requested',RESTORE_DB)=='0'
assert sql('SELECT count(*) FROM provider_connections WHERE enabled',RESTORE_DB)=='0'
run(['docker','volume','create',VOLUME])
try:
 run(['docker','run','--rm','--label','com.docker.compose.project='+PROJECT,'--label','com.docker.compose.service=restore-proof','-i','--entrypoint','tar','-v',VOLUME+':/restore','agent-office-backup:latest','--acls','-C','/restore','-xzf','-'],parts['artifacts.tar.gz'])
 for uid in ('10001:10001','20001:20001'):
  restored=run(['docker','run','--rm','--label','com.docker.compose.project='+PROJECT,'--label','com.docker.compose.service=restore-proof','--user',uid,'--entrypoint','cat','-v',VOLUME+':/restore:ro','agent-office-backup:latest',f'/restore/runs/{runid}/result.md'])
  assert hashlib.sha256(restored).digest()==hashlib.sha256(original).digest()
finally:run(['docker','volume','rm',VOLUME])
# A pre-existing pause belongs to its operator and must survive a successful backup.
sql('UPDATE office_maintenance SET paused=true WHERE id')
try:preserved=backup();wait_job(preserved,'ready');assert sql('SELECT paused FROM office_maintenance')=='t'
finally:sql('UPDATE office_maintenance SET paused=false WHERE id')
# A missing registered artifact fails closed and always releases this service's pause.
run(COMPOSE+['exec','-T','worker','mv',f'/data/runs/{runid}/result.md',f'/data/runs/{runid}/result.saved'])
try:
 failed=backup();wait_job(failed,'failed');assert sql('SELECT paused FROM office_maintenance')=='f';assert call(c,'/admin/backups/'+failed+'/download')[0]==404
finally:run(COMPOSE+['exec','-T','worker','mv',f'/data/runs/{runid}/result.saved',f'/data/runs/{runid}/result.md'])
# A helper outage can be recovered from the admin endpoint without cancelling an AI task.
slow=ok(call(c,base+'/tasks',{'title':'Recovery wait proof','description':'[test:slow]','provider':'codex'}))['id'];sp=base+'/tasks/'+slow;ok(call(c,sp+'/run',{'billing_acknowledged':True}))
for _ in range(100):
 if ok(call(c,sp))['task']['status']=='running':break
 time.sleep(.1)
interrupted=backup();wait_job(interrupted,'waiting');run(COMPOSE+['stop','backup']);ok(call(c,'/admin/backups/recover',{}));assert sql('SELECT paused FROM office_maintenance')=='f'
assert next(x for x in ok(call(c,'/admin/backups'))['jobs'] if x['id']==interrupted)['status']=='failed'
run(COMPOSE+['start','backup'])
assert ok(call(c,sp))['task']['status']!='cancelled'
run(COMPOSE+['exec','-T','postgres','dropdb','-U','office',RESTORE_DB])
print(json.dumps({'database_restore':True,'registered_file_restore':True,'acl_read_restored_for_uids':[10001,20001],'checksums':True,'unregistered_files_excluded':True,'sessions_and_ai_bindings_excluded':True,'knowledge_agents_skills_workflows_master_and_attachment_verified':True,'preexisting_pause_preserved':True,'missing_artifact_fails_closed':True,'offline_recovery_unpauses_without_cancelling_ai':True,'backup_bytes':j['bytes'],'model_calls':0}))
