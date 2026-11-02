"""Opt-in Docker integration probe. Requires the disposable agent-office-runtime-preview
project on port 8107 with office_test and fixture workers. Never runs real AI.
Run: OFFICE_RUNTIME_TEST=isolated_preview python3 tests/probe_runtime_runner.py
"""
import os
assert os.environ.get('OFFICE_RUNTIME_TEST') == 'isolated_preview', 'Explicit isolated-preview opt-in required'
import os,sys,json,subprocess,time,urllib.request,urllib.error
P='agent-office-runtime-preview'
for svc in ['app','worker','runner']:
 cfg=json.loads(subprocess.check_output(['docker','inspect',P+'-'+svc+'-1']))[0];env=dict(v.split('=',1) for v in cfg['Config']['Env'] if '=' in v);assert env['DATABASE_URL'].endswith('/office_test');mounts=[m['Destination'] for m in cfg['Mounts']];assert not any('auth' in m.get('Name','') for m in cfg['Mounts'])
 if svc=='worker':assert env['WORKER_MODE']=='fixture' and env['ALLOW_TEST_WORKER']=='1' and '/var/run/docker.sock' not in mounts
 if svc=='app':assert '/var/run/docker.sock' not in mounts
 if svc=='runner':assert '/var/run/docker.sock' in mounts
os.environ['BASE_URL']='http://127.0.0.1:8107';sys.path.insert(0,'tests');from test_api import call,client
c=client()
def ok(r):assert r[0]==200,r;return r[1]
ok(call(c,'/auth/login',{'email':'runtime-preview@office.local','password':'runtime-preview-local-2026'}));wid=ok(call(c,'/workspaces',{'name':'Managed Runner verification'}))['id'];base='/workspaces/'+wid
ok(call(c,'/connections/codex',{'enabled':True,'billing_acknowledged':True},'PUT'))
results=[];live=[]
def source(label,markers,enabled=True):
 tid=ok(call(c,base+'/tasks',{'title':label,'description':'[test:node-preview] '+markers,'provider':'codex','runtime_enabled':enabled}))['id'];path=base+'/tasks/'+tid;ok(call(c,path+'/run',{'billing_acknowledged':True}))
 for _ in range(160):
  detail=ok(call(c,path))
  if detail['task']['status']=='review':return path,detail
  time.sleep(.15)
 raise AssertionError('Fixture source missing')
def wait(path):
 last=None
 for _ in range(800):
  jobs=ok(call(c,path+'/runtime'))['jobs']
  if jobs:
   j=jobs[0]
   if last!=j['status']:print(path.split('/')[-1],j['status'],flush=True);last=j['status']
   if j['status'] in ['ready','failed','stopped']:return j
  time.sleep(.4)
 raise AssertionError('Runtime timed out')
def fetch(j,path='/',cookie=None,host=None):
 from urllib.parse import urlsplit
 headers={'Host':host or urlsplit(j['evidence']['url']).netloc}
 if cookie:headers['Cookie']=cookie
 req=urllib.request.Request('http://127.0.0.1:'+str(j['port'])+path,headers=headers)
 try:
  with urllib.request.urlopen(req,timeout=8) as r:return r.status,r.read().decode(),r.headers
 except urllib.error.HTTPError as e:return e.code,e.read().decode(),e.headers
def stop(j,path):
 ok(call(c,base+'/runtime/'+j['id']+'/stop',{}))
 for _ in range(100):
  row=ok(call(c,path+'/runtime'))['jobs'][0]
  if row['status']=='stopped':return
  time.sleep(.25)
 raise AssertionError('Cleanup did not finish')
def log(j):return ok(call(c,base+'/runtime/'+j['id']+'/logs'))['content']
try:
 path,d=source('Russia Home — actual managed build and tests','[test:runtime-build]');assert d['task']['execution_context']['standards'][0]['version']==1;assert call(c,path+'/review',{'accept':True,'feedback':'premature'})[0]==409
 j=wait(path)
 if j['status']!='ready':print(log(j));raise AssertionError(j)
 assert all(j['evidence'][k] for k in ['build_passed','tests_passed','http_passed','host_port_published']);assert j['evidence']['source_run_id']==d['task']['current_run_id'];assert fetch(j)[0]==200 and 'Explore Russia' in fetch(j)[1];assert 'Managed build completed' in fetch(j,'/__build-proof')[1];assert 'pass 3' in log(j)
 assert json.loads(fetch(j,'/__cookie-check','office_session=synthetic')[1])['cookies_received']==False;assert json.loads(fetch(j,'/__cookie-check','app_session=synthetic')[1])['cookies_received']==True
 cookies=fetch(j,'/__set-cookie')[2].get_all('Set-Cookie');assert len(cookies)==1 and 'app_session=' in cookies[0] and 'domain=' not in cookies[0].lower();assert fetch(j,host='evil.example')[0]==421
 containers=json.loads(subprocess.check_output(['docker','inspect']+subprocess.check_output(['docker','ps','-q','--filter','label=office.job='+j['id']]).decode().split()))
 app=next(v for v in containers if v['Config']['Labels'].get('com.docker.compose.service')=='app');gateway=next(v for v in containers if v['Config']['Labels'].get('office.role')=='gateway');assert app['HostConfig']['ReadonlyRootfs'] and app['Config']['User']=='1000:1000' and app['HostConfig']['Memory']==536870912;assert app['HostConfig']['CapDrop']==['ALL'];assert all(m['Destination']!='/var/run/docker.sock' for m in app['Mounts']);assert not any(m['RW'] for m in app['Mounts'] if m['Destination']=='/workspace');assert not gateway['Mounts'];assert gateway['NetworkSettings']['Ports']['3000/tcp'][0]['HostIp']=='127.0.0.1';assert len(app['NetworkSettings']['Networks'])==1
 results.append('Real Docker image, bounded install/build, three Node HTTP tests, localhost Gateway, build output, source evidence, cookie/host isolation and container restrictions')
 open('/private/tmp/office-runtime-preview-ids.json','w').write(json.dumps({'base':base,'task':path.split('/')[-1],'path':path,'job':j['id'],'port':j['port'],'url':j['evidence']['url']}));healthy=j
 for label,marker,phase in [('Unsafe manifest','[test:runtime-unsafe]',None),('Failing tests','[test:runtime-test-fail]','testing'),('Failing HTTP check','[test:runtime-health-fail]','starting')]:
  p,_=source(label,marker);bad=wait(p);assert bad['status']=='failed',(bad,log(bad));assert call(c,p+'/review',{'accept':True,'feedback':'must not pass'})[0]==409
  if phase:assert bad['evidence']['failed_phase']==phase
  assert not subprocess.check_output(['docker','ps','-aq','--filter','label=office.job='+bad['id']]).strip();assert fetch(healthy)[0]==200;results.append(label+' rejected and isolated cleanup verified')
  # Verify producer retry receives exact failed evidence without granting worker DB access.
  if phase=='testing':
   ok(call(c,p+'/review',{'accept':False,'feedback':'Fix tests using Runner evidence'}));ok(call(c,p+'/run',{'billing_acknowledged':True}));context=ok(call(c,p))['task']['execution_context'];assert context['runtime_feedback']['source_run_id']==bad['source_run_id'];assert context['runtime_feedback']['evidence']['tests_passed']==False;results.append('Producer retry receives previous failing test evidence')
   # Cancel requeued runtime once fixture finishes to avoid unnecessary failing rerun.
   for _ in range(120):
    inv=ok(call(c,p+'/runtime'))['jobs']
    if inv[0]['id']!=bad['id']:
     stop(inv[0],p);break
    time.sleep(.15)
 p,_=source('Nested source directory','[test:runtime-nested] [test:runtime-build]');nested=wait(p);assert nested['status']=='ready',(nested,log(nested));assert 'Managed build completed' in fetch(nested,'/__build-proof')[1];stop(nested,p);assert fetch(healthy)[0]==200;results.append('Nested source directory and explicit stop preserve other previews')
 print(json.dumps({'checks':results,'model_calls':0,'healthy_url':healthy['evidence']['url']},ensure_ascii=False),flush=True);open('/private/tmp/office-runtime-probe-results.json','w').write(json.dumps({'checks':results,'model_calls':0},indent=2))

 # Gate Agent review on matching runtime, then keep final delivery with owner.
 for fails in [False,True]:
  lead=ok(call(c,base+'/agents',{'name':'Runtime lead','role':'Lead','instructions':'Review measured source evidence','provider':'codex','enabled':True}))['id'];dev=ok(call(c,base+'/agents',{'name':'Runtime developer','role':'Engineer','instructions':'Deliver actual source','provider':'codex','enabled':True}))['id']
  steps=[{'title':'Build runnable source','description':'[test:node-preview] '+('[test:runtime-test-fail]' if fails else '[test:runtime-build]'),'agent_id':dev,'depends_on':[],'required_files':['office-run.json','server.mjs'],'review_mode':'agent','review_agent_id':lead,'runtime_enabled':True},{'title':'Final owner acceptance','description':'Summarize verified delivery','agent_id':lead,'depends_on':[0],'review_mode':'owner'}]
  wf=ok(call(c,base+'/workflows',{'title':'Runtime gate verification','steps':steps}))['id'];pid=ok(call(c,base+'/workflows/'+wf+'/instantiate',{'version':0,'goal':'Exercise actual runtime review gate','request_id':__import__('uuid').uuid4().hex}))['plan_id'];ids=ok(call(c,base+'/plans/'+pid+'/approve',{'version':0,'billing_acknowledged':True}))['tasks'];path=base+'/tasks/'+ids[0]
  for _ in range(400):
   state=ok(call(c,base));task=next(t for t in state['tasks'] if t['id']==ids[0]);reviews=[t for t in state['tasks'] if t.get('review_for_task_id')==ids[0]];jobs=ok(call(c,path+'/runtime'))['jobs']
   if not jobs or jobs[0]['status'] in ['queued','building','testing','starting']:assert not reviews,'Reviewer ran before measured runtime'
   if (fails and task['review_state']=='needs_owner') or (not fails and task['status']=='done'):break
   time.sleep(.25)
  else:raise AssertionError((task,jobs))
  assert len(reviews)==1;review=ok(call(c,base+'/tasks/'+reviews[0]['id']))['task'];assert review['execution_context']['agent_review']['runtime_evidence']['id']==jobs[0]['id']
  final=ok(call(c,base+'/tasks/'+ids[1]))['task']
  if fails:assert task['status']=='review' and final['attempts']==0
  else:
   assert task['review_state']=='passed' and len(state['knowledge'])>=1;assert ok(call(c,base+'/plans/'+pid+'/delivery-evidence'))['runtime_verified']
   ok(call(c,base+'/plans/'+pid+'/cancel',{}))
   for _ in range(100):
    if ok(call(c,path+'/runtime'))['jobs'][0]['status']=='stopped':break
    time.sleep(.25)
   else:raise AssertionError('Cancelled plan left preview running')
   results.append('Cancelling the plan stops its accepted source preview')
  results.append('Failed runtime cannot be passed by naive Agent reviewer' if fails else 'Reviewer waits for matching runtime; accepted work creates Knowledge and final task stays with owner')
  assert fetch(healthy)[0]==200
 # Stop and expiry do not affect another workspace's ready preview.
 p,_=source('Expiration verification','');j=wait(p);assert j['status']=='ready'
 subprocess.run(['docker','exec',P+'-postgres-1','psql','-U','office','-d','office_test','-qc',"UPDATE runtime_jobs SET expires_at=now()-interval '1 second' WHERE id='"+j['id']+"'"],check=True)
 for _ in range(100):
  if ok(call(c,p+'/runtime'))['jobs'][0]['status']=='stopped':break
  time.sleep(.25)
 else:raise AssertionError('Expiry did not clean preview')
 assert fetch(healthy)[0]==200;results.append('Expired preview cleaned automatically without affecting another workspace')
 # Restart while HTTP readiness is failing: interrupted execution must stop, not replay.
 p,_=source('Interrupted readiness verification','[test:runtime-health-fail]')
 for _ in range(250):
  jobs=ok(call(c,p+'/runtime'))['jobs']
  if jobs and jobs[0]['status']=='starting':j=jobs[0];break
  time.sleep(.15)
 else:raise AssertionError('No interruptible readiness phase')
 subprocess.run(['docker','restart',P+'-runner-1'],stdout=subprocess.DEVNULL,check=True)
 for _ in range(120):
  row=ok(call(c,p+'/runtime'))['jobs'][0]
  if row['status']=='stopped':break
  time.sleep(.25)
 else:raise AssertionError(row)
 assert not subprocess.check_output(['docker','ps','-aq','--filter','label=office.job='+j['id']]).strip();assert fetch(healthy)[0]==200;time.sleep(2.2);assert len(ok(call(c,p+'/runtime'))['jobs'])==1;results.append('Runner restart cleans interrupted job without replay; existing ready preview survives')
 p,_=source('Busy Runner heartbeat verification','[test:runtime-health-fail]')
 for _ in range(300):
  inv=ok(call(c,p+'/runtime'))
  if inv['jobs'] and inv['jobs'][0]['status']=='starting':j=inv['jobs'][0];break
  time.sleep(.1)
 else:raise AssertionError('No busy readiness phase')
 subprocess.run(['docker','exec',P+'-postgres-1','psql','-U','office','-d','office_test','-qc',"UPDATE runtime_runner SET heartbeat_at=now()-interval '1 hour' WHERE id"],check=True)
 time.sleep(6)
 inv=ok(call(c,p+'/runtime'));assert inv['online'] and inv['jobs'][0]['status']=='starting',inv
 stop(j,p)
 results.append('Busy Runner heartbeat updates independently while a runtime operation is still active')
 print(json.dumps({'checks':results,'model_calls':0},ensure_ascii=False),flush=True);__import__('pathlib').Path('/private/tmp/office-runtime-workflow-results.json').write_text(json.dumps({'checks':results,'model_calls':0},indent=2))
finally:
 # The probe owns this fresh test Workspace. Clean only its generated jobs.
 for task in ok(call(c,base))['tasks']:
  p=base+'/tasks/'+task['id']
  for row in ok(call(c,p+'/runtime'))['jobs']:
   if row['status'] not in ['stopped','failed']:stop(row,p)
 print('Owned test previews stopped and cleaned; no live model calls.',flush=True)
