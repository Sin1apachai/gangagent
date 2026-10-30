import os,time,uuid,unittest,concurrent.futures
from test_api import client,call

class Organization(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.admin=client()
  for _ in range(90):
   try:
    if call(cls.admin,'/auth/login',{'email':os.environ['OWNER_EMAIL'],'password':os.environ['OWNER_PASSWORD']})[0]==200:break
   except Exception:pass
   time.sleep(1)
  else:raise RuntimeError('Owner login failed')
  for _ in range(30):
   if any(w['online'] and w['mode']=='fixture' for w in call(cls.admin,'/connections')[1]['workers']):break
   time.sleep(1)
  else:raise RuntimeError('Isolated fixture worker required')
  for provider in ('codex','claude'):assert call(cls.admin,'/connections/'+provider,{'enabled':True,'billing_acknowledged':True},'PUT')[0]==200
 @classmethod
 def tearDownClass(cls):
  for provider in ('codex','claude'):call(cls.admin,'/connections/'+provider,{'enabled':False,'billing_acknowledged':False},'PUT')
 def setUp(self):
  self.wid=call(self.admin,'/workspaces',{'name':'Organization test '+str(uuid.uuid4())})[1]['id'];self.base='/workspaces/'+self.wid
 def get(self,suffix='',c=None):return call(c or self.admin,self.base+suffix)
 def send(self,suffix,data=None,method=None,c=None):return call(c or self.admin,self.base+suffix,data,method)
 def ok(self,response):self.assertEqual(response[0],200,response);return response[1]
 def agent(self,name='Builder'):
  return self.ok(self.send('/agents',{'name':name,'role':'Engineer','instructions':'ROLE_ORIGINAL','provider':'codex','enabled':True}))['id']
 def skill(self,marker='SKILL_ORIGINAL'):
  body={'title':'Engineering playbook','description':'Reusable methods','instructions':marker,'input_contract':'Source brief','output_contract':'Reviewable artifact','acceptance_criteria':'Evidence required'}
  return self.ok(self.send('/skills',body))['id'],body
 def org(self,aid,manager=None,bindings=None,c=None,**extra):
  a=next(a for a in self.get()[1]['agents'] if a['id']==aid)
  return self.send('/agents/'+aid+'/organization',{'version':a['version'],'manager_id':manager,'skills':bindings or [],'department':'Engineering','responsibilities':'OWNERSHIP_MARKER','decision_scope':'DECISION_MARKER',**extra},'PUT',c)
 def task(self,aid,description='Write a report'):
  return self.ok(self.send('/tasks',{'title':'Skill task','description':description,'provider':'codex','agent_id':aid}))['id']
 def detail(self,tid):return self.ok(self.get('/tasks/'+tid))
 def start(self,tid):return self.send('/tasks/'+tid+'/run',{'billing_acknowledged':True})
 def wait(self,tid,status,timeout=30):
  until=time.monotonic()+timeout
  while time.monotonic()<until:
   d=self.detail(tid)
   if d['task']['status']==status:return d
   time.sleep(.12)
  self.fail('Expected '+status+', got '+str(d))
 def review(self,tid,accept=True,c=None):return self.send('/tasks/'+tid+'/review',{'accept':accept,'feedback':'Accepted' if accept else 'Please revise with stronger evidence'},c=c)
 def step(self,aid,title='Produce',deps=None,**extra):return {'title':title,'description':'Produce complete result','agent_id':aid,'depends_on':deps or [],'required_files':['result.md'],'input_contract':'Brief','output_contract':'Report','acceptance_criteria':'Complete content',**extra}
 def workflow(self,steps):return self.ok(self.send('/workflows',{'title':'Office delivery','description':'Branch and review','steps':steps}))['id']
 def launch(self,wid,version=0,request_id=None,goal='Deliver verified work'):
  return self.send('/workflows/'+wid+'/instantiate',{'version':version,'goal':goal,'request_id':request_id or str(uuid.uuid4())})
 def approve(self,pid,version=0):return self.send('/plans/'+pid+'/approve',{'version':version,'billing_acknowledged':True})
 def member(self,role='member'):
  email='organization-'+str(uuid.uuid4())+'@office.local';pw='test-password-only-12345'
  uid=self.ok(call(self.admin,'/admin/users',{'name':'Review member','email':email,'password':pw}))['id'];c=client();self.ok(call(c,'/auth/login',{'email':email,'password':pw}));self.ok(self.send('/members',{'email':email,'role':role}));return c,uid
 def test_skill_revision_conflict_archive_history(self):
  sid,b=self.skill();self.ok(self.send('/skills/'+sid,{**b,'version':0,'instructions':'SKILL_V2'},'PUT'))
  self.assertEqual(self.send('/skills/'+sid,{**b,'version':0},'PUT')[0],409)
  history=self.ok(self.get('/skills/'+sid));self.assertEqual([v['version'] for v in history],[1,0]);self.assertEqual(history[1]['instructions'],'SKILL_ORIGINAL')
  self.ok(self.send('/skills/'+sid,method='DELETE'));self.assertTrue(self.get('/skills')[1][0]['deleted_at'])
  self.assertEqual(self.send('/skills/'+sid,{**b,'version':1},'PUT')[0],409)
  self.ok(self.send('/skills/'+sid+'/restore',{}));self.assertEqual(self.get('/skills')[1][0]['version'],1)
  self.assertEqual(self.send('/skills',{**b,'instructions':''})[0],400)
 def test_reporting_deep_cycle_and_foreign_manager(self):
  agents=[self.agent('Member '+str(i)) for i in range(12)]
  for i in range(1,len(agents)):self.ok(self.org(agents[i],agents[i-1]))
  self.assertEqual(self.org(agents[0],agents[-1])[0],400);self.assertEqual(self.org(agents[0],agents[0])[0],400)
  foreign=self.ok(call(self.admin,'/workspaces',{'name':'Foreign org'}))['id'];aid=self.ok(call(self.admin,'/workspaces/'+foreign+'/agents',{'name':'Foreign','role':'Lead','instructions':'','provider':'codex','enabled':True}))['id']
  self.assertEqual(self.org(agents[0],aid)[0],400)
  self.ok(self.send('/agents/'+agents[5],method='DELETE'));self.assertEqual(self.org(agents[0],agents[-1])[0],400)
  self.ok(self.send('/agents/'+agents[5]+'/restore',{}));self.assertEqual(len(self.get('/organization')[1]['agents']),12)
 def test_concurrent_opposite_reporting_edges_cannot_cycle(self):
  a,b=self.agent('A'),self.agent('B')
  with concurrent.futures.ThreadPoolExecutor(2) as pool:results=list(pool.map(lambda pair:self.org(*pair),[(a,b),(b,a)]))
  self.assertEqual(sorted(r[0] for r in results),[200,400])
 def test_binding_validation_and_permissions(self):
  aid=self.agent();sid,_=self.skill();binding={'skill_id':sid,'pinned_version':0}
  self.assertEqual(self.org(aid,bindings=[binding,binding])[0],400)
  self.assertEqual(self.org(aid,bindings=[{**binding,'pinned_version':88}])[0],400)
  self.ok(self.org(aid,bindings=[binding]));c,_=self.member();self.assertEqual(self.org(aid,c=c)[0],403)
  viewer,_=self.member('viewer')
  for path in ('/skills','/organization','/workflows','/reviewers'):self.assertEqual(self.get(path,viewer)[0],200)
  self.assertEqual(self.send('/skills',{'title':'No','instructions':'No'},c=viewer)[0],403)
 def test_frozen_skills_latest_pinned_and_revision(self):
  aid=self.agent();sid,body=self.skill();self.ok(self.org(aid,bindings=[{'skill_id':sid,'pinned_version':None}]))
  tid=self.task(aid,'[test:slow] Produce');self.ok(self.start(tid));self.ok(self.send('/skills/'+sid,{**body,'version':0,'instructions':'SKILL_NEW_VERSION'},'PUT'))
  result=self.wait(tid,'review')['task']['result'];self.assertIn('SKILL_ORIGINAL',result);self.assertNotIn('SKILL_NEW_VERSION',result);self.assertIn('OWNERSHIP_MARKER',result);self.assertIn('DECISION_MARKER',result)
  self.ok(self.review(tid,False));self.ok(self.start(tid));self.assertIn('SKILL_ORIGINAL',self.wait(tid,'review')['task']['result'])
  newer=self.task(aid);self.ok(self.start(newer));self.assertIn('SKILL_NEW_VERSION',self.wait(newer,'review')['task']['result'])
  self.ok(self.org(aid,bindings=[{'skill_id':sid,'pinned_version':0}]))
  pinned=self.task(aid);self.ok(self.start(pinned));self.assertIn('SKILL_ORIGINAL',self.wait(pinned,'review')['task']['result'])
  self.ok(self.send('/skills/'+sid,method='DELETE'));blocked=self.task(aid);self.assertEqual(self.start(blocked)[0],400);self.assertEqual(self.detail(blocked)['task']['attempts'],0);self.assertFalse(self.detail(blocked)['task']['execution_requested'])
  self.ok(self.send('/skills/'+sid+'/restore',{}));self.ok(self.start(blocked));self.wait(blocked,'review')
 def test_workflow_revision_idempotency_and_draft_snapshot(self):
  aid=self.agent();steps=[self.step(aid)];wid=self.workflow(steps);request=str(uuid.uuid4());first=self.ok(self.launch(wid,request_id=request));self.assertFalse(first['replayed']);self.assertEqual(self.get()[1]['tasks'],[])
  replay=self.ok(self.launch(wid,request_id=request));self.assertTrue(replay['replayed']);self.assertEqual(first['plan_id'],replay['plan_id']);self.assertEqual(self.launch(wid,request_id=request,goal='Different')[0],409)
  self.ok(self.send('/workflows/'+wid,{'title':'Changed workflow','description':'Updated','version':0,'steps':[self.step(aid,'NEW_TITLE')]},'PUT'))
  plan=next(p for p in self.get('/plans')[1] if p['id']==first['plan_id']);self.assertEqual(plan['steps'][0]['title'],'Produce');self.assertEqual(plan['workflow_snapshot']['version'],0)
  self.assertEqual(self.send('/workflows/'+wid,{'title':'Stale','version':0,'steps':steps},'PUT')[0],409);self.assertEqual(len(self.get('/workflows/'+wid)[1]),2)
  self.ok(self.send('/workflows/'+wid,method='DELETE'));self.assertEqual(self.launch(wid)[0],404);self.ok(self.send('/workflows/'+wid+'/restore',{}));self.ok(self.launch(wid,version=0))
 def test_concurrent_workflow_launch_is_exactly_one_draft(self):
  wid=self.workflow([self.step(self.agent())]);request=str(uuid.uuid4())
  with concurrent.futures.ThreadPoolExecutor(2) as pool:results=list(pool.map(lambda _:self.launch(wid,request_id=request),range(2)))
  rows=[self.ok(r) for r in results];self.assertEqual(len({r['plan_id'] for r in rows}),1);self.assertEqual(len(self.get('/plans')[1]),1)
 def test_workflow_branch_join_review_revision_gates(self):
  aid=self.agent();sid,_=self.skill();self.ok(self.org(aid,bindings=[{'skill_id':sid,'pinned_version':None}]))
  steps=[self.step(aid,'Brief',skill_ids=[sid]),self.step(aid,'Research',[0]),self.step(aid,'Design',[0]),self.step(aid,'Final',[1,2])]
  pid=self.ok(self.launch(self.workflow(steps)))['plan_id'];tids=self.ok(self.approve(pid))['tasks'];self.wait(tids[0],'review')
  self.assertTrue(all(self.detail(t)['task']['attempts']==0 for t in tids[1:]));self.ok(self.review(tids[0]));self.wait(tids[1],'review');self.wait(tids[2],'review')
  self.ok(self.review(tids[1],False));self.ok(self.review(tids[2]));time.sleep(.3);self.assertEqual(self.detail(tids[3])['task']['attempts'],0)
  self.ok(self.start(tids[1]));self.wait(tids[1],'review');self.ok(self.review(tids[1]));final=self.wait(tids[3],'review');self.assertEqual(final['task']['execution_context']['workflow']['depends_on'],[1,2]);self.ok(self.review(tids[3]));self.assertEqual(self.detail(tids[3])['task']['status'],'done')
  self.assertEqual(self.approve(pid)[0],409)
 def test_required_file_gate_and_unsafe_paths(self):
  aid=self.agent();wid=self.workflow([self.step(aid,required_files=['missing.txt']),self.step(aid,'Downstream',[0])]);pid=self.ok(self.launch(wid))['plan_id'];tids=self.ok(self.approve(pid))['tasks'];d=self.wait(tids[0],'failed');self.assertIn('missing.txt',d['task']['error']);self.assertEqual(self.detail(tids[1])['task']['attempts'],0);self.assertEqual(d['task']['attempts'],1)
  for name in ('../escape','/absolute','inputs/parent.md','references/ref.txt','a\\b','a/./b','a//b'):
   self.assertEqual(self.send('/workflows',{'title':'Unsafe','steps':[self.step(aid,required_files=[name]) ]})[0],400,name)
 def test_approval_revalidates_skills_atomically(self):
  aid=self.agent();sid,_=self.skill();self.ok(self.org(aid,bindings=[{'skill_id':sid,'pinned_version':None}]))
  wid=self.workflow([self.step(aid),self.step(aid,'Requires skill',[0],skill_ids=[sid])]);pid=self.ok(self.launch(wid))['plan_id'];self.ok(self.org(aid))
  self.assertEqual(self.approve(pid)[0],400);self.assertEqual(self.get()[1]['tasks'],[]);self.assertEqual(self.get('/plans')[1][0]['status'],'draft')
  invalid=self.ok(self.send('/plans',{'goal':'Invalid manual agent','steps':[self.step(str(uuid.uuid4()))]}))['id']
  self.assertEqual(self.approve(invalid)[0],400)
  self.assertEqual(self.get()[1]['tasks'],[])

 def test_workflow_invalid_dags_and_contracts(self):
  aid=self.agent()
  for steps in ([self.step(aid,deps=[0])],[self.step(aid),self.step(aid,deps=[0,0])],[self.step(aid,skill_ids=[str(uuid.uuid4())])],[self.step(aid,required_files=['result.md','result.md'])],[self.step(aid,input_contract='x'*4001)],[self.step(aid)]*9):
   self.assertEqual(self.send('/workflows',{'title':'Invalid','steps':steps})[0],400)
 def test_assigned_reviewer_and_owner_reassignment(self):
  reviewer,rid=self.member();other,oid=self.member();aid=self.agent();wid=self.workflow([self.step(aid,reviewer_id=rid)]);pid=self.ok(self.launch(wid))['plan_id'];tid=self.ok(self.approve(pid))['tasks'][0];self.wait(tid,'review')
  self.assertEqual(self.review(tid,c=other)[0],403)
  self.assertEqual(self.send('/tasks/'+tid+'/reviewer',{'version':self.detail(tid)['task']['version'],'reviewer_id':oid},'PUT',other)[0],403)
  self.ok(self.send('/members/'+rid,method='DELETE'));self.assertEqual(self.review(tid,c=reviewer)[0],403)
  v=self.detail(tid)['task']['version'];self.ok(self.send('/tasks/'+tid+'/reviewer',{'version':v,'reviewer_id':oid},'PUT'));self.assertEqual(self.send('/tasks/'+tid+'/reviewer',{'version':v,'reviewer_id':rid},'PUT')[0],400)
  self.ok(self.review(tid,c=other));self.assertEqual(self.detail(tid)['task']['status'],'done')
 def test_workspace_isolation_for_libraries_and_history(self):
  aid=self.agent();sid,_=self.skill();wid=self.workflow([self.step(aid)]);outsider=client();email='outsider-'+str(uuid.uuid4())+'@office.local';pw='test-password-only-12345';self.ok(call(self.admin,'/admin/users',{'name':'Outsider','email':email,'password':pw}));self.ok(call(outsider,'/auth/login',{'email':email,'password':pw}))
  for suffix in ('/skills','/skills/'+sid,'/organization','/workflows','/workflows/'+wid):self.assertEqual(self.get(suffix,outsider)[0],403)
  self.assertEqual(self.send('/workflows/'+wid+'/instantiate',{'version':0,'goal':'No','request_id':str(uuid.uuid4())},c=outsider)[0],403)

 def test_launch_request_id_cannot_cross_workspace(self):
  workflow=self.workflow([self.step(self.agent())]);request=str(uuid.uuid4());self.ok(self.launch(workflow,request_id=request))
  old_base=self.base
  self.wid=self.ok(call(self.admin,'/workspaces',{'name':'Second launch workspace'}))['id'];self.base='/workspaces/'+self.wid
  other=self.workflow([self.step(self.agent())])
  self.assertEqual(self.launch(other,request_id=request)[0],409)
  self.assertEqual(self.get('/plans')[1],[])
  self.assertEqual(self.launch(workflow,request_id=request)[0],409)
  concurrent_request=str(uuid.uuid4())
  paths=[old_base+'/workflows/'+workflow+'/instantiate',self.base+'/workflows/'+other+'/instantiate']
  with concurrent.futures.ThreadPoolExecutor(2) as pool:
   results=list(pool.map(lambda path:call(self.admin,path,{'version':0,'goal':'Cross-workspace race','request_id':concurrent_request}),paths))
  self.assertEqual(sorted(r[0] for r in results),[200,409])


 def test_agent_character_selection_persists_and_validates(self):
  body={'name':'Character selection','role':'Designer','instructions':'Keep appearance','provider':'codex','enabled':True,'character_id':11}
  aid=self.ok(self.send('/agents',body))['id']
  row=next(a for a in self.get()[1]['agents'] if a['id']==aid);self.assertEqual(row['character_id'],11)
  self.ok(self.send('/agents/'+aid,{**body,'character_id':5,'version':row['version']},'PUT'))
  self.assertEqual(self.send('/agents/'+aid,{**body,'version':row['version']},'PUT')[0],409)
  row=next(a for a in self.get()[1]['agents'] if a['id']==aid)
  legacy={k:v for k,v in body.items() if k!='character_id'}
  self.ok(self.send('/agents/'+aid,{**legacy,'version':row['version']},'PUT'))
  self.assertEqual(next(a for a in self.get()[1]['agents'] if a['id']==aid)['character_id'],5)
  for invalid in (-1,12,100):self.assertEqual(self.send('/agents',{**body,'character_id':invalid})[0],400)
  for value in range(12):
   created=self.ok(self.send('/agents',{**body,'name':'Variant '+str(value),'character_id':value}))['id']
   self.assertEqual(next(a for a in self.get()[1]['agents'] if a['id']==created)['character_id'],value)
