"""Host bind-mount recovery probe. Disposable named test project only; no AI inference."""
import os,sys,json,time,subprocess,uuid,hashlib,shutil
from pathlib import Path
assert os.environ.get('OFFICE_CODE_TEST')=='isolated_preview', 'Explicit isolated code-preview opt-in required'
P='agent-office-code-preview';root=Path('/private/tmp/office-code-host-proof')
for svc in ['app','worker','export-test']:
 cfg=json.loads(subprocess.check_output(['docker','inspect',P+'-'+svc+'-1']))[0];env=dict(x.split('=',1) for x in cfg['Config']['Env'] if '=' in x);assert env['DATABASE_URL'].endswith('/office_test');assert not any('auth' in m.get('Name','') or m['Destination']=='/var/run/docker.sock' for m in cfg['Mounts'])
 if svc=='worker':assert env['WORKER_MODE']=='fixture' and env['ALLOW_TEST_WORKER']=='1'
os.environ['BASE_URL']='http://127.0.0.1:8110';sys.path.insert(0,'tests');from test_api import call,client
c=client()
def ok(r):assert r[0]==200,r;return r[1]
for _ in range(80):
 try:
  if call(c,'/health')[0]==200:break
 except Exception:pass
 time.sleep(.2)
ok(call(c,'/auth/login',{'email':'code-preview@office.local','password':'code-preview-local-2026'}));w=ok(call(c,'/workspaces',{'name':'ONE'}));assert w['code_directory']=='workspace/one';assert call(c,'/workspaces',{'name':'  one  '})[0]==409
unicode='Café '+uuid.uuid4().hex;ok(call(c,'/workspaces',{'name':unicode}));assert call(c,'/workspaces',{'name':unicode.replace('é','e\u0301')})[0]==409
for _ in range(80):
 if (root/'one'/'.office-workspace.json').is_file():break
 time.sleep(.2)
else:raise AssertionError('Workspace folder not created')
ok(call(c,'/connections/codex',{'enabled':True,'billing_acknowledged':True},'PUT'));base='/workspaces/'+w['id'];tid=ok(call(c,base+'/tasks',{'title':'Host code folder proof','description':'[test:node-preview]','provider':'codex'}))['id'];path=base+'/tasks/'+tid;ok(call(c,path+'/run',{'billing_acknowledged':True}))
for _ in range(200):
 d=ok(call(c,path))
 if d['task']['status']=='review':break
 time.sleep(.15)
else:raise AssertionError('Fixture task not completed')
run=d['task']['current_run_id'];uuid.UUID(run);folder=root/'one'/'tasks'/tid/'runs'/run
def exported(status='ready'):
 for _ in range(200):
  inv=ok(call(c,path+'/code-folder'));row=next((r for r in inv['runs'] if r['run_id']==run),None)
  if row and row['status']==status:return row
  time.sleep(.15)
 raise AssertionError(inv)
row=exported();assert row['files']>=6 and (folder/'server.mjs').is_file();marker=json.loads((folder/'.office-export.json').read_text());assert marker['run_id']==run
for f in marker['files']:
 actual=(folder/f['name']).read_bytes();assert hashlib.sha256(actual).hexdigest()==f['sha256'];a=next(a for a in d['artifacts'] if a['run_id']==run and a['name']==f['name']);registered=c.open('http://127.0.0.1:8110/api'+path+'/artifacts/'+a['id']).read();assert actual==registered
assert not (folder/'inputs').exists() and not (folder/'references').exists()
def sql(q):return subprocess.check_output(['docker','exec',P+'-postgres-1','psql','-U','office','-d','office_test','-Atc',q],text=True).strip()
# A restart must recover after filesystem publication but before database acknowledgement.
sql("DELETE FROM workspace_code_exports WHERE run_id='"+run+"'");exported();assert (folder/'server.mjs').is_file()
# Simulate moving/restoring Office without its generated host copies.
assert folder.is_relative_to(root);shutil.rmtree(folder);exported();
for _ in range(100):
 if (folder/'server.mjs').is_file():break
 time.sleep(.1)
else:raise AssertionError('Missing copy not regenerated')
exported();assert 'createApp' in (folder/'server.mjs').read_text()
# If a host user edits a published snapshot, reconciliation must never overwrite it.
(folder/'server.mjs').write_text('Host edit must survive');sql("DELETE FROM workspace_code_exports WHERE run_id='"+run+"'");failed=exported('failed');assert 'edited' in failed['error'];assert (folder/'server.mjs').read_text()=='Host edit must survive'
# Leave an original unedited source snapshot available for UI confirmation.
(folder/'server.mjs').write_bytes(next(c.open('http://127.0.0.1:8110/api'+path+'/artifacts/'+a['id']).read() for a in d['artifacts'] if a['run_id']==run and a['name']=='server.mjs'));sql("DELETE FROM workspace_code_exports WHERE run_id='"+run+"'");exported()
proof={'host_directory_created':True,'actual_code_matches_every_registered_file':True,'case_and_unicode_duplicate_names_blocked':True,'publish_ack_recovery':True,'missing_export_regenerated_after_restore':True,'host_edits_not_overwritten':True,'model_calls':0};Path('/private/tmp/office-code-host-results.json').write_text(json.dumps(proof,indent=2));Path('/private/tmp/office-code-host-ids.json').write_text(json.dumps({'base':base,'path':path,'run':run,'folder':str(folder)}));print(json.dumps(proof),flush=True)
