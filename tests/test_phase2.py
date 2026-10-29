import os,time,uuid,unittest,urllib.request
from test_api import client,call,BASE

class PhaseTwo(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.admin=client()
  for _ in range(60):
   try:
    if call(cls.admin,'/auth/login',{'email':os.environ['OWNER_EMAIL'],'password':os.environ['OWNER_PASSWORD']})[0]==200:break
   except Exception: pass
   time.sleep(1)
  else: raise RuntimeError('Owner login failed')
  for _ in range(30):
   info=call(cls.admin,'/connections')[1]
   if any(w['online'] and w['mode']=='fixture' for w in info['workers']):break
   time.sleep(1)
  else:raise RuntimeError('Refusing execution tests: isolated fixture worker is required')
  for p in ('codex','claude'):
   assert call(cls.admin,'/connections/'+p,{'enabled':True,'billing_acknowledged':True},'PUT')[0]==200
 @classmethod
 def tearDownClass(cls):
  for p in ('codex','claude'):call(cls.admin,'/connections/'+p,{'enabled':False,'billing_acknowledged':False},'PUT')
 def setUp(self):
  self.wid=call(self.admin,'/workspaces',{'name':'Phase2 '+str(uuid.uuid4())})[1]['id']
 def snap(self,c=None):return call(c or self.admin,'/workspaces/'+self.wid)[1]
 def task(self,description='',provider='codex',agent_id=None):
  status,t=call(self.admin,f'/workspaces/{self.wid}/tasks',{'title':'Execute test task','description':description,'provider':provider,'agent_id':agent_id})
  self.assertEqual(status,200);return t['id']
 def path(self,tid):return f'/workspaces/{self.wid}/tasks/{tid}'
 def detail(self,tid):return call(self.admin,self.path(tid))[1]
 def start(self,tid):return call(self.admin,self.path(tid)+'/run',{'billing_acknowledged':True})
 def wait(self,tid,status,timeout=25):
  until=time.monotonic()+timeout
  while time.monotonic()<until:
   d=self.detail(tid)
   if d['task']['status']==status:return d
   time.sleep(.15)
  self.fail('Expected '+status+', got '+str(d))
 def new_user(self):
  email=f'phase2-{uuid.uuid4()}@office.local';pw='test-only-password-12345'
  status,u=call(self.admin,'/admin/users',{'name':'Test member','email':email,'password':pw});self.assertEqual(status,200)
  c=client();self.assertEqual(call(c,'/auth/login',{'email':email,'password':pw})[0],200)
  return c,u['id'],email,pw
 def test_workspace_crud_and_recovery(self):
  s=self.snap();path='/workspaces/'+self.wid
  self.assertEqual(call(self.admin,path,{'name':'Renamed','version':s['version']},'PUT')[0],200)
  self.assertEqual(call(self.admin,path,{'name':'Stale','version':s['version']},'PUT')[0],409)
  self.assertEqual(call(self.admin,path,method='DELETE')[0],200)
  self.assertEqual(call(self.admin,path)[0],404)
  self.assertTrue(any(w['id']==self.wid for w in call(self.admin,'/trash')[1]))
  self.assertEqual(call(self.admin,path+'/restore',{})[0],200);self.assertEqual(self.snap()['name'],'Renamed')
 def test_task_crud_and_recovery(self):
  tid=self.task();path=self.path(tid);t=self.detail(tid)['task']
  b={'title':'Edited','description':'new','provider':'claude','agent_id':None,'version':t['version']}
  self.assertEqual(call(self.admin,path,b,'PUT')[0],200);self.assertEqual(call(self.admin,path,b,'PUT')[0],409)
  self.assertEqual(call(self.admin,path,method='DELETE')[0],200);self.assertEqual(call(self.admin,path)[0],404)
  self.assertEqual(call(self.admin,path+'/restore',{})[0],200);self.assertEqual(self.detail(tid)['task']['title'],'Edited')
  self.assertFalse(self.detail(tid)['task']['execution_requested'])
 def test_knowledge_crud_and_verification(self):
  base=f'/workspaces/{self.wid}/knowledge';_,k=call(self.admin,base,{'title':'Rule','content':'original','source':'owner','verified':True});kid=k['id']
  n=next(n for n in self.snap()['knowledge'] if n['id']==kid);self.assertTrue(n['verified'])
  b={'title':'Updated rule','content':'edited','source':'review','verified':False,'version':n['version']}
  self.assertEqual(call(self.admin,base+'/'+kid,b,'PUT')[0],200);self.assertEqual(call(self.admin,base+'/'+kid,b,'PUT')[0],409)
  self.assertEqual(call(self.admin,base+'/'+kid,method='DELETE')[0],200);self.assertFalse(self.snap()['knowledge'])
  self.assertEqual(call(self.admin,base+'/'+kid+'/restore',{})[0],200);self.assertEqual(self.snap()['knowledge'][0]['content'],'edited')
 def test_agent_crud_and_provider_validation(self):
  path=f'/workspaces/{self.wid}/agents';b={'name':'Real user agent','role':'Builder','instructions':'Use concise output','provider':'claude','x':4,'y':5,'enabled':True}
  _,a=call(self.admin,path,b);aid=a['id'];b['name']='Updated agent';b['version']=0
  self.assertEqual(call(self.admin,path+'/'+aid,b,'PUT')[0],200);self.assertEqual(call(self.admin,path+'/'+aid,b,'PUT')[0],409)
  self.assertEqual(call(self.admin,f'/workspaces/{self.wid}/tasks',{'title':'Mismatch','description':'','provider':'codex','agent_id':aid})[0],400)
  self.assertEqual(call(self.admin,path,{**b,'x':20})[0],400)
  self.assertEqual(call(self.admin,path+'/'+aid,method='DELETE')[0],200);self.assertFalse(self.snap()['agents'])
  self.assertEqual(call(self.admin,path+'/'+aid+'/restore',{})[0],200);self.assertEqual(self.snap()['agents'][0]['name'],'Updated agent')
 def test_viewer_and_membership_controls(self):
  c,uid,email,_=self.new_user();path=f'/workspaces/{self.wid}/members'
  self.assertEqual(call(self.admin,path,{'email':email,'role':'viewer'})[0],200)
  self.assertEqual(call(c,'/workspaces/'+self.wid)[0],200)
  self.assertEqual(call(c,f'/workspaces/{self.wid}/tasks',{'title':'denied','description':'','provider':'codex'})[0],403)
  self.assertEqual(call(c,f'/workspaces/{self.wid}/knowledge',{'title':'denied','content':'denied','source':''})[0],403)
  self.assertEqual(call(c,'/workspaces/'+self.wid,{'name':'denied','version':0},'PUT')[0],403)
  self.assertEqual(call(c,path)[0],403)
  self.assertEqual(call(self.admin,path,{'email':email,'role':'member'})[0],200)
  self.assertEqual(call(c,f'/workspaces/{self.wid}/tasks',{'title':'allowed','description':'','provider':'codex'})[0],200)
  self.assertEqual(call(self.admin,path+'/'+uid,method='DELETE')[0],200);self.assertEqual(call(c,'/workspaces/'+self.wid)[0],403)
  me=call(self.admin,'/auth/me')[1];self.assertEqual(call(self.admin,path+'/'+me['id'],method='DELETE')[0],409)
 def test_user_crud_revokes_sessions(self):
  c,uid,email,pw=self.new_user();path='/admin/users/'+uid
  self.assertEqual(call(self.admin,path,{'name':'Renamed member','email':email,'password':''},'PUT')[0],200)
  self.assertEqual(call(c,'/auth/me')[1]['name'],'Renamed member')
  self.assertEqual(call(self.admin,path,method='DELETE')[0],200);self.assertEqual(call(c,'/auth/me')[0],401)
  self.assertEqual(call(client(),'/auth/login',{'email':email,'password':pw})[0],401)
  self.assertEqual(call(self.admin,path+'/restore',{})[0],200)
  self.assertEqual(call(c,'/auth/login',{'email':email,'password':pw})[0],200)
  owner=call(self.admin,'/auth/me')[1]['id'];self.assertEqual(call(self.admin,'/admin/users/'+owner,method='DELETE')[0],403)
 def test_profile_requires_current_password_for_sensitive_changes(self):
  c,uid,email,pw=self.new_user()
  self.assertEqual(call(c,'/profile',{'name':'Me','email':email,'password':''},'PUT')[0],200)
  self.assertEqual(call(c,'/profile',{'name':'Me','email':'new-'+email,'password':''},'PUT')[0],401)
  self.assertEqual(call(c,'/profile',{'name':'Me','email':'new-'+email,'password':'new-test-password-12345','current_password':pw},'PUT')[0],200)
  self.assertEqual(call(c,'/auth/me')[0],401)
  self.assertEqual(call(c,'/auth/login',{'email':'new-'+email,'password':'new-test-password-12345'})[0],200)
 def test_worker_complete_review_download_and_knowledge_context(self):
  base=f'/workspaces/{self.wid}/knowledge'
  call(self.admin,base,{'title':'Verified','content':'VERIFIED_CONTEXT_MARKER','source':'test','verified':True})
  call(self.admin,base,{'title':'Unverified','content':'UNVERIFIED_MUST_NOT_APPEAR','source':'test','verified':False})
  tid=self.task('Make a deliverable');self.assertEqual(self.start(tid)[0],200);d=self.wait(tid,'review')
  self.assertIn('FIXTURE TEST ONLY',d['task']['result']);self.assertIn('VERIFIED_CONTEXT_MARKER',d['task']['result']);self.assertNotIn('UNVERIFIED_MUST_NOT_APPEAR',d['task']['result'])
  self.assertEqual(len(d['runs']),1);self.assertTrue(d['artifacts']);self.assertTrue(d['events'])
  with self.admin.open(BASE+'/api'+self.path(tid)+'/artifacts/'+d['artifacts'][0]['id']) as r:self.assertIn(b'FIXTURE TEST ONLY',r.read())
  self.assertEqual(call(self.admin,self.path(tid)+'/review',{'accept':True,'feedback':'Accepted'})[0],200);self.assertEqual(self.detail(tid)['task']['status'],'done')
 def test_revision_requires_explicit_restart(self):
  tid=self.task('ORIGINAL_DELIVERABLE_MARKER');self.start(tid);first=self.wait(tid,'review')['task']['result']
  self.assertEqual(call(self.admin,self.path(tid)+'/review',{'accept':False,'feedback':''})[0],400)
  self.assertEqual(call(self.admin,self.path(tid)+'/review',{'accept':False,'feedback':'REVISION_FEEDBACK_MARKER'})[0],200)
  time.sleep(.5);t=self.detail(tid)['task'];self.assertEqual(t['status'],'queued');self.assertFalse(t['execution_requested']);self.assertEqual(t['attempts'],1)
  self.start(tid);d=self.wait(tid,'review');self.assertEqual(len(d['runs']),2);self.assertIn('REVISION_FEEDBACK_MARKER',d['task']['result'])
  self.assertIn(first,d['task']['result']);self.assertIn('Previous reviewed result',d['task']['result'])
  self.assertEqual(len({a['run_id'] for a in d['artifacts']}),2)
 def test_cancel_running_and_prevent_edit_or_workspace_delete(self):
  tid=self.task('[test:slow]');self.start(tid);d=self.wait(tid,'running')
  self.assertEqual(call(self.admin,'/workspaces/'+self.wid,method='DELETE')[0],409)
  self.assertEqual(call(self.admin,self.path(tid),{'title':'no','description':'','provider':'codex','version':d['task']['version']},'PUT')[0],409)
  self.assertEqual(call(self.admin,self.path(tid),method='DELETE')[0],409)
  self.assertEqual(call(self.admin,self.path(tid)+'/cancel',{})[0],200);self.wait(tid,'cancelled')
 def test_quota_blocks_without_automatic_retry(self):
  tid=self.task('[test:quota]');self.start(tid);d=self.wait(tid,'waiting_quota');time.sleep(.5)
  self.assertFalse(d['task']['execution_requested']);self.assertEqual(self.detail(tid)['task']['attempts'],1)
 def test_failed_retries_have_three_attempt_cap(self):
  tid=self.task('[test:fail]')
  for i in range(3):self.assertEqual(self.start(tid)[0],200);self.wait(tid,'failed')
  self.assertEqual(self.start(tid)[0],409);self.assertEqual(len(self.detail(tid)['runs']),3)
 def test_billing_ack_and_provider_ownership(self):
  tid=self.task();self.assertEqual(call(self.admin,self.path(tid)+'/run',{'billing_acknowledged':False})[0],400)
  self.assertEqual(call(self.admin,'/connections/codex',{'enabled':True,'billing_acknowledged':False},'PUT')[0],400)
  c,uid,email,_=self.new_user();call(self.admin,f'/workspaces/{self.wid}/members',{'email':email,'role':'member'})
  call(c,'/connections/codex',{'enabled':True,'billing_acknowledged':True},'PUT')
  self.assertEqual(call(c,self.path(tid)+'/run',{'billing_acknowledged':True})[0],409)
 def test_multiple_workers_claim_each_task_once(self):
  tids=[self.task() for _ in range(6)]
  for tid in tids:self.assertEqual(self.start(tid)[0],200)
  for tid in tids:self.assertEqual(len(self.wait(tid,'review')['runs']),1)
 def test_artifact_does_not_cross_workspace(self):
  tid=self.task();self.start(tid);d=self.wait(tid,'review');aid=d['artifacts'][0]['id'];c,_,_,_=self.new_user()
  self.assertEqual(call(c,self.path(tid)+'/artifacts/'+aid)[0],403)
  status,other=call(self.admin,'/workspaces',{'name':'Artifact isolation target'});self.assertEqual(status,200)
  self.assertEqual(call(self.admin,f'/workspaces/{other["id"]}/tasks/{tid}/artifacts/{aid}')[0],404)

 def test_disabling_connection_cancels_running_task(self):
  tid=self.task('[test:slow]');self.start(tid);self.wait(tid,'running')
  try:
   self.assertEqual(call(self.admin,'/connections/codex',{'enabled':False,'billing_acknowledged':False},'PUT')[0],200)
   self.assertEqual(call(self.admin,'/connections/codex',{'enabled':True,'billing_acknowledged':True},'PUT')[0],200)
   self.wait(tid,'cancelled')
  finally:call(self.admin,'/connections/codex',{'enabled':True,'billing_acknowledged':True},'PUT')
 def test_deleted_agent_cannot_be_used_to_start_a_task(self):
  path=f'/workspaces/{self.wid}/agents';_,a=call(self.admin,path,{'name':'Temporary agent','role':'Builder','instructions':'','provider':'codex','x':1,'y':1,'enabled':True})
  tid=self.task(agent_id=a['id']);call(self.admin,path+'/'+a['id'],method='DELETE')
  self.assertEqual(self.start(tid)[0],409)

 def pending_member_job(self):
  c,uid,email,pw=self.new_user()
  self.assertEqual(call(self.admin,f'/workspaces/{self.wid}/members',{'email':email,'role':'member'})[0],200)
  self.assertEqual(call(c,'/connections/codex',{'enabled':True,'billing_acknowledged':True},'PUT')[0],200)
  status,t=call(c,f'/workspaces/{self.wid}/tasks',{'title':'Unclaimed user job','description':'','provider':'codex'})
  self.assertEqual(status,200);path=self.path(t['id'])
  self.assertEqual(call(c,path+'/run',{'billing_acknowledged':True})[0],200)
  self.assertTrue(call(c,path)[1]['task']['execution_requested'])
  return c,uid,email,pw,path
 def test_workspace_restore_does_not_resume_pending_execution(self):
  c,uid,email,pw,path=self.pending_member_job()
  self.assertEqual(call(self.admin,'/workspaces/'+self.wid,method='DELETE')[0],200)
  self.assertEqual(call(self.admin,'/workspaces/'+self.wid+'/restore',{})[0],200)
  self.assertFalse(call(c,path)[1]['task']['execution_requested'])
  self.assertEqual(call(c,path+'/run',{'billing_acknowledged':True})[0],200)
 def test_user_restore_does_not_resume_pending_execution(self):
  c,uid,email,pw,path=self.pending_member_job()
  self.assertEqual(call(self.admin,'/admin/users/'+uid,method='DELETE')[0],200)
  self.assertEqual(call(self.admin,'/admin/users/'+uid+'/restore',{})[0],200)
  self.assertEqual(call(c,'/auth/login',{'email':email,'password':pw})[0],200)
  self.assertFalse(call(c,path)[1]['task']['execution_requested'])
 def test_restored_membership_requires_explicit_restart(self):
  c,uid,email,pw,path=self.pending_member_job()
  members=f'/workspaces/{self.wid}/members'
  for remove in (False,True):
   if remove:
    self.assertEqual(call(self.admin,members+'/'+uid,method='DELETE')[0],200)
   else:
    self.assertEqual(call(self.admin,members,{'email':email,'role':'viewer'})[0],200)
   self.assertEqual(call(self.admin,members,{'email':email,'role':'member'})[0],200)
   self.assertFalse(call(c,path)[1]['task']['execution_requested'])
   self.assertEqual(call(c,path+'/run',{'billing_acknowledged':True})[0],200)

 def test_revision_copies_source_files_without_overwriting_history(self):
  tid=self.task('[test:revision-files]');self.start(tid);first=self.wait(tid,'review')
  old=next(a for a in first['artifacts'] if a['name']=='nested/draft.txt')
  self.assertEqual(call(self.admin,self.path(tid)+'/review',{'accept':False,'feedback':'Update the draft'})[0],200)
  self.assertEqual(self.start(tid)[0],200);second=self.wait(tid,'review')
  latest=next(a for a in second['artifacts'] if a['name']=='nested/draft.txt' and a['run_id']==second['runs'][0]['id'])
  with self.admin.open(BASE+'/api'+self.path(tid)+'/artifacts/'+old['id']) as r:self.assertEqual(r.read(),b'ORIGINAL_FILE_CONTENT')
  with self.admin.open(BASE+'/api'+self.path(tid)+'/artifacts/'+latest['id']) as r:self.assertEqual(r.read(),b'REVISED_FILE_CONTENT')
  self.assertTrue(any('Copied 2 previous artifacts' in e['message'] for e in second['events']))

 def login_request(self,provider):
  status,r=call(self.admin,'/connections/'+provider+'/login',{})
  self.assertEqual(status,200)
  for _ in range(100):
   entry=next(l for l in call(self.admin,'/connections')[1]['logins'] if l['id']==r['id'])
   if entry['status']=='waiting':return entry
   time.sleep(.1)
  self.fail('Login request did not become ready')
 def test_web_login_is_owner_scoped_and_cancellable(self):
  login=self.login_request('codex');lid=login['id']
  try:
   self.assertEqual(login['device_code'],'TEST-ONLY')
   self.assertTrue(login['login_url'].startswith('https://auth.openai.com/'))
   self.assertEqual(call(self.admin,'/connections/claude/login',{})[0],409)
   c,uid,email,pw=self.new_user()
   self.assertEqual(call(c,'/connections')[0],200)
   self.assertFalse(call(c,'/connections')[1]['logins'])
   self.assertEqual(call(c,'/connections/login/'+lid+'/cancel',{})[0],404)
   self.assertEqual(call(c,'/connections/login/'+lid+'/code',{'code':'test'})[0],404)
   self.assertEqual(call(c,'/connections/codex/login',{})[0],409)
   self.assertEqual(call(self.admin,'/connections/login/'+lid+'/code',{'code':'test'})[0],404)
  finally:self.assertEqual(call(self.admin,'/connections/login/'+lid+'/cancel',{})[0],200)
  entry=next(l for l in call(self.admin,'/connections')[1]['logins'] if l['id']==lid)
  self.assertEqual(entry['status'],'cancelled');self.assertFalse(entry['login_url']);self.assertFalse(entry['device_code'])
 def test_claude_one_time_code_not_returned_by_api(self):
  login=self.login_request('claude');lid=login['id']
  try:
   self.assertEqual(call(self.admin,'/connections/login/'+lid+'/code',{'code':'sk-test-not-a-code'})[0],400)
   self.assertEqual(call(self.admin,'/connections/login/'+lid+'/code',{'code':'has whitespace'})[0],400)
   self.assertEqual(call(self.admin,'/connections/login/'+lid+'/code',{'code':'ONE_TIME_FIXTURE_CODE'})[0],200)
   self.assertNotIn('ONE_TIME_FIXTURE_CODE',str(call(self.admin,'/connections')[1]))
  finally:call(self.admin,'/connections/login/'+lid+'/cancel',{})

 def test_project_crud_and_task_project_scope(self):
  base=f'/workspaces/{self.wid}/projects'
  status,p=call(self.admin,base,{'name':'Project','description':'Scope'});self.assertEqual(status,200)
  pid=p['id'];self.assertEqual(call(self.admin,base+'/'+pid,{'name':'Renamed','description':'','version':0},'PUT')[0],200)
  self.assertEqual(call(self.admin,base+'/'+pid,{'name':'Stale','version':0},'PUT')[0],409)
  b={'title':'Project task','description':'','provider':'codex','project_id':pid,'priority':'urgent','acceptance_criteria':'Must pass'}
  status,t=call(self.admin,f'/workspaces/{self.wid}/tasks',b);self.assertEqual(status,200)
  self.assertEqual(self.detail(t['id'])['task']['priority'],'urgent')
  other=call(self.admin,'/workspaces',{'name':'Other project scope'})[1]['id']
  self.assertEqual(call(self.admin,f'/workspaces/{other}/tasks',b)[0],400)
  self.assertEqual(call(self.admin,base+'/'+pid,method='DELETE')[0],200)
  self.assertEqual(call(self.admin,f'/workspaces/{self.wid}/tasks',b)[0],400)
  self.assertEqual(call(self.admin,base+'/'+pid+'/restore',{})[0],200)
 def test_team_dependencies_require_acceptance_and_handoff(self):
  path=f'/workspaces/{self.wid}/agents'
  aid=call(self.admin,path,{'name':'Team builder','role':'Builder','instructions':'','provider':'codex','x':0,'y':0,'enabled':True})[1]['id']
  steps=[{'title':'First step','description':'TEAM_HANDOFF_MARKER','agent_id':aid,'depends_on':[]},{'title':'Review previous','description':'Use upstream accepted result','agent_id':aid,'depends_on':[0]}]
  base=f'/workspaces/{self.wid}/plans'
  status,p=call(self.admin,base,{'goal':'Team acceptance','steps':steps});self.assertEqual(status,200)
  self.assertFalse(any(t.get('plan_id')==p['id'] for t in self.snap()['tasks']))
  self.assertEqual(call(self.admin,base+'/'+p['id']+'/approve',{'version':0,'billing_acknowledged':False})[0],400)
  status,r=call(self.admin,base+'/'+p['id']+'/approve',{'version':0,'billing_acknowledged':True});self.assertEqual(status,200)
  first,second=r['tasks'];self.wait(first,'review');time.sleep(.5)
  self.assertEqual(self.detail(second)['task']['attempts'],0)
  self.assertEqual(call(self.admin,base+'/'+p['id']+'/approve',{'version':0,'billing_acknowledged':True})[0],409)
  call(self.admin,self.path(first)+'/review',{'accept':True,'feedback':'Accepted'})
  d=self.wait(second,'review');self.assertIn('TEAM_HANDOFF_MARKER',d['task']['result'])
  self.assertTrue(any(a['name'].startswith('inputs/') for a in d['artifacts']))
  self.assertEqual(call(self.admin,base+'/'+p['id']+'/cancel',{})[0],200)
 def test_plan_cycles_and_foreign_agents_are_rejected(self):
  path=f'/workspaces/{self.wid}/plans'
  aid=call(self.admin,f'/workspaces/{self.wid}/agents',{'name':'Planner','role':'Manager','instructions':'','provider':'claude','x':0,'y':0,'enabled':True})[1]['id']
  bad=[{'title':'Cycle','description':'','agent_id':aid,'depends_on':[0]}]
  self.assertEqual(call(self.admin,path,{'goal':'Cycle','steps':bad})[0],400)
  self.assertEqual(call(self.admin,path,{'goal':'Too many','steps':[dict(bad[0],depends_on=[]) for _ in range(9)]})[0],400)
  status,p=call(self.admin,path,{'goal':'Manual draft','steps':[]});self.assertEqual(status,200)
  steps=[{'title':'Foreign','description':'','agent_id':str(uuid.uuid4()),'depends_on':[]}]
  self.assertEqual(call(self.admin,path+'/'+p['id'],{'goal':'Foreign','steps':steps,'version':0},'PUT')[0],400)
 def test_global_intelligence_is_granted_revocable_and_verified_only(self):
  c,uid,email,pw=self.new_user();q='GLOBAL_SEARCH_'+uuid.uuid4().hex
  call(self.admin,f'/workspaces/{self.wid}/knowledge',{'title':q,'content':'Verified source','source':'Owner','verified':True})
  call(self.admin,f'/workspaces/{self.wid}/knowledge',{'title':q+' DRAFT','content':'DO_NOT_RETURN','source':'','verified':False})
  query='/knowledge/search?global=true&q='+q
  self.assertEqual(call(c,query)[0],403)
  self.assertEqual(call(c,'/admin/intelligence/'+uid,{'enabled':True},'PUT')[0],403)
  self.assertEqual(call(self.admin,'/admin/intelligence/'+uid,{'enabled':True},'PUT')[0],200)
  status,result=call(c,query);self.assertEqual(status,200);self.assertEqual(len(result['results']),1)
  self.assertEqual(result['results'][0]['workspace_id'],self.wid);self.assertNotIn('DO_NOT_RETURN',str(result))
  self.assertEqual(call(self.admin,'/admin/intelligence/'+uid,{'enabled':False},'PUT')[0],200);self.assertEqual(call(c,query)[0],403)
 def test_reference_files_are_scoped_and_available_to_worker(self):
  tid=self.task('Use reference file');base=self.path(tid)+'/attachments'
  self.assertEqual(call(self.admin,base,{'name':'../escape','data':[1]})[0],400)
  payload=b'REFERENCE_INPUT_MARKER';status,f=call(self.admin,base,{'name':'brief.txt','data':list(payload)});self.assertEqual(status,200)
  c,_,_,_=self.new_user();self.assertEqual(call(c,base+'/'+f['id'])[0],403)
  with self.admin.open(BASE+'/api'+base+'/'+f['id']) as r:self.assertEqual(r.read(),payload)
  self.start(tid);d=self.wait(tid,'review');ref=next(a for a in d['artifacts'] if a['name'].startswith('references/'))
  with self.admin.open(BASE+'/api'+self.path(tid)+'/artifacts/'+ref['id']) as r:self.assertEqual(r.read(),payload)
  self.assertEqual(call(self.admin,base+'/'+f['id'],method='DELETE')[0],200)

 def test_personal_worker_credentials_and_revoke_scope(self):
  c,uid,_,_=self.new_user()
  status,b=call(c,'/personal-workers',{'label':'Private worker'})
  self.assertEqual(status,200)
  env=b['compose']['services']['worker']['environment']
  self.assertIn('ow_',env['DATABASE_URL']);self.assertGreaterEqual(int(env['MODEL_UID']),20000)
  rows=call(c,'/personal-workers')[1];self.assertEqual(len(rows),1)
  self.assertNotIn('DATABASE_URL',str(rows));self.assertNotIn('redis_hash',str(rows))
  self.assertEqual(call(self.admin,'/personal-workers/'+b['id'],method='DELETE')[0],404)
  self.assertEqual(call(c,'/personal-workers/'+b['id'],method='DELETE')[0],200)
  self.assertTrue(call(c,'/personal-workers')[1][0]['revoked_at'])
  self.assertEqual(call(c,'/personal-workers',{'label':''})[0],400)
