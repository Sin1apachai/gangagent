"""Opt-in persistent code + real Docker proof; requires a fresh disposable fixture stack on 8110."""
import os,sys,json,time,subprocess,uuid
from pathlib import Path
assert os.environ.get('OFFICE_PROJECT_CODE_TEST')=='isolated_preview', 'Opt in only for a fresh disposable agent-office-code-preview fixture stack'
P='agent-office-code-preview';root=Path('/private/tmp/office-code-host-proof')
for svc in ['app','worker','runner']:
 cfg=json.loads(subprocess.check_output(['docker','inspect',P+'-'+svc+'-1']))[0];env=dict(x.split('=',1) for x in cfg['Config']['Env'] if '=' in x);assert env['DATABASE_URL'].endswith('/office_test');assert not any('auth' in m.get('Name','') for m in cfg['Mounts'])
 if svc=='worker':assert env['WORKER_MODE']=='fixture' and env['ALLOW_TEST_WORKER']=='1';assert all(m['Destination']!='/workspace' and m['Destination']!='/var/run/docker.sock' for m in cfg['Mounts'])
 if svc=='runner':assert next(m for m in cfg['Mounts'] if m['Destination']=='/data')['RW']==False
os.environ['BASE_URL']='http://127.0.0.1:8110';sys.path.insert(0,'tests');from test_api import call,client
c=client()
def ok(r):assert r[0]==200,r;return r[1]
for _ in range(80):
 try:
  if call(c,'/health')[0]==200:break
 except Exception:pass
 time.sleep(.2)
ok(call(c,'/auth/login',{'email':'code-preview@office.local','password':'code-preview-local-2026'}));w=ok(call(c,'/workspaces',{'name':'ONE'}));base='/workspaces/'+w['id'];pid=ok(call(c,base+'/projects',{'name':'Purchase','description':'Program working tree proof'}))['id'];code=root/'one'/'purchase';ok(call(c,'/connections/codex',{'enabled':True,'billing_acknowledged':True},'PUT'))
def start(markers='',runtime=False):
 tid=ok(call(c,base+'/tasks',{'title':'Persistent program '+uuid.uuid4().hex[:6],'description':'[test:project-code] [test:node-preview] '+markers,'provider':'codex','project_id':pid,'runtime_enabled':runtime}))['id'];p=base+'/tasks/'+tid;ok(call(c,p+'/run',{'billing_acknowledged':True}));return p
def wait(p,state='review'):
 for _ in range(300):
  d=ok(call(c,p))
  if d['task']['status']==state:return d
  if d['task']['status']=='failed':raise AssertionError(d['task']['error'])
  time.sleep(.1)
 raise AssertionError(d['task']['status'])
def synced(p,expected='synced'):
 for _ in range(200):
  d=ok(call(c,p+'/code-folder'))
  if d['session'] and d['session']['state']==expected:return d
  time.sleep(.1)
 raise AssertionError(d)
p=start('[test:knowledge-doc]',True);d=wait(p);inventory=synced(p);assert inventory['path']=='workspace/one/purchase';assert(code/'server.mjs').is_file() and(code/'package.json').is_file();assert not(code/'requirements.md').exists();assert any(a['name']=='requirements.md' for a in d['artifacts']);assert not(root/'one'/'tasks').exists() and not(root/'one'/'runs').exists()
for _ in range(800):
 jobs=ok(call(c,p+'/runtime'))['jobs']
 if jobs and jobs[0]['status'] in ['ready','failed']:job=jobs[0];break
 time.sleep(.25)
else:raise AssertionError('Managed runtime timed out')
if job['status']!='ready':print(ok(call(c,base+'/runtime/'+job['id']+'/logs'))['content']);raise AssertionError(job)
assert job['evidence']['http_passed'] and job['evidence']['tests_passed'];ok(call(c,base+'/runtime/'+job['id']+'/stop',{}))
for _ in range(100):
 if ok(call(c,p+'/runtime'))['jobs'][0]['status']=='stopped':break
 time.sleep(.2)
original=(code/'server.mjs').read_text();(code/'server.mjs').write_text(original+'\n// manual-host-edit\n');p2=start('[test:project-observe]');d2=wait(p2);synced(p2);assert (code/'server.mjs').read_text().endswith('// manual-host-edit\n');a=next(a for a in d2['artifacts'] if a['name']=='code/server.mjs');assert 'manual-host-edit' in c.open('http://127.0.0.1:8110/api'+p2+'/artifacts/'+a['id']).read().decode();assert synced(p2)['path']==inventory['path']
p3=start('[test:project-conflict]')
for _ in range(100):
 state=ok(call(c,p3+'/code-folder'))
 if state['session'] and state['session']['state']=='active' and 'manual-host-edit' not in (code/'server.mjs').read_text():break
 time.sleep(.1)
else:raise AssertionError('Live code sync missing')
assert ok(call(c,p3))['task']['status']=='running';(code/'server.mjs').write_text('HOST CHANGE PRESERVED');wait(p3);synced(p3,'conflict');assert (code/'server.mjs').read_text()=='HOST CHANGE PRESERVED';assert call(c,p3+'/review',{'accept':True,'feedback':'Must be blocked on conflict'})[0]==409
proof={'persistent_project_folder':True,'same_tree_across_tasks':True,'manual_host_edits_loaded_into_next_task':True,'live_program_sync_during_running_task':True,'conflict_preserves_host_edit':True,'task_reports_not_in_program_folder':True,'no_task_or_run_folders_on_host':True,'managed_node_build_tests_http_from_code_prefix':True,'history_mount_stays_read_only':True,'model_calls':0};Path('/private/tmp/project-code-proof.json').write_text(json.dumps(proof,indent=2));Path('/private/tmp/project-code-ui.json').write_text(json.dumps({'path':p2,'workspace':w['id']}));print(json.dumps(proof),flush=True)
