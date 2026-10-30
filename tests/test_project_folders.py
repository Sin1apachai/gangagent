import json,time,unittest,uuid,urllib.request
from test_api import call,client
import test_organization as support
class ProjectFolders(unittest.TestCase):
 setUpClass=classmethod(support.Organization.setUpClass.__func__)
 tearDownClass=classmethod(support.Organization.tearDownClass.__func__)
 ok=support.Organization.ok
 def setUp(self):
  self.wid=self.ok(call(self.admin,'/workspaces',{'name':'Folder integration '+uuid.uuid4().hex}))['id'];self.base='/workspaces/'+self.wid;self.owner=self.ok(call(self.admin,'/auth/me'))['id']
 def pick(self):return self.ok(call(self.admin,self.base+'/project-folders/pick',{}))
 def bridge(self,route,folder,**extra):
  req=urllib.request.Request('http://project-bridge:18089'+route,data=json.dumps({**folder,'owner':self.owner,**extra}).encode(),headers={'Authorization':'Bearer fixture-project-bridge-token-12345','Content-Type':'application/json'})
  with urllib.request.urlopen(req) as r:return json.load(r)
 def project(self,folder):return self.ok(call(self.admin,self.base+'/projects',{'name':'Local project','working_folder':folder}))['id']
 def task(self,pid,description):return self.ok(call(self.admin,self.base+'/tasks',{'title':'Project fixture','description':description,'provider':'codex','project_id':pid}))['id']
 def wait(self,tid,status):
  for _ in range(220):
   d=self.ok(call(self.admin,self.base+'/tasks/'+tid))
   if d['task']['status']==status:return d
   if d['task']['status'] in ('failed','review') and status not in ('failed','review'):self.fail(str(d))
   time.sleep(.1)
  self.fail('Task did not reach '+status)
 def test_native_selection_validation_legacy_edit_and_unlink(self):
  self.assertEqual(call(client(),self.base+'/project-folders/pick',{})[0],401)
  f=self.pick();pid=self.project({**f,'path':'/forged/path'})
  p=self.ok(call(self.admin,self.base+'/projects'))[0];self.assertEqual(p['working_folder'],f)
  self.ok(call(self.admin,self.base+'/projects/'+pid,{'name':'Rename','version':0},'PUT'));p=self.ok(call(self.admin,self.base+'/projects'))[0];self.assertEqual(p['working_folder'],f)
  self.ok(call(self.admin,self.base+'/projects/'+pid,{'name':'Unlink','version':1,'working_folder':{}},'PUT'));self.assertIsNone(self.ok(call(self.admin,self.base+'/projects'))[0]['working_folder'])
  self.assertEqual(call(self.admin,self.base+'/projects',{'name':'Invalid','working_folder':{**f,'id':str(uuid.uuid4())}})[0],400)
  c=client();email=uuid.uuid4().hex+'@office.local';pw='test-folder-password-123';self.ok(call(self.admin,'/admin/users',{'name':'Separate user','email':email,'password':pw}));self.ok(call(c,'/auth/login',{'email':email,'password':pw}));other=self.ok(call(c,'/workspaces',{'name':'Other folder office'}))['id']
  self.assertEqual(call(c,self.base+'/project-folders/pick',{})[0],403)
  self.assertEqual(call(c,'/workspaces/'+other+'/projects',{'name':'Borrowed folder','working_folder':f})[0],400)
 def test_worker_reads_project_writes_back_and_freezes_selected_folder(self):
  first=self.pick();second=self.pick();pid=self.project(first);tid=self.task(pid,'[test:project-files]')
  self.ok(call(self.admin,self.base+'/tasks/'+tid+'/run',{'billing_acknowledged':True}))
  self.ok(call(self.admin,self.base+'/projects/'+pid,{'name':'Changed folder','version':0,'working_folder':second},'PUT'))
  d=self.wait(tid,'review');self.assertEqual(d['task']['execution_context']['project_folder']['id'],first['id'])
  self.assertIn('EXISTING_PROJECT_FILE',d['task']['result'])
  files={f['path']:f['content'] for f in self.bridge('/snapshot',first)['files']};self.assertEqual(files['src/agent.txt'],'AGENT_PROJECT_OUTPUT');self.assertEqual(files['hello.txt'],'AGENT_UPDATED_PROJECT_FILE')
  self.assertNotIn('src/agent.txt',[f['path'] for f in self.bridge('/snapshot',second)['files']]);self.assertTrue(any(a['name']=='project/src/agent.txt' for a in d['artifacts']))
 def test_concurrent_human_edit_stops_publication_and_retains_artifacts(self):
  f=self.pick();pid=self.project(f);tid=self.task(pid,'[test:project-files] [test:slow]');self.ok(call(self.admin,self.base+'/tasks/'+tid+'/run',{'billing_acknowledged':True}))
  for _ in range(180):
   d=self.ok(call(self.admin,self.base+'/tasks/'+tid))
   if any('Prepared project snapshot' in e['message'] for e in d['events']):break
   time.sleep(.1)
  else:self.fail('Snapshot not prepared')
  s=self.bridge('/snapshot',f);self.bridge('/publish',f,snapshot_id=s['snapshot_id'],files=[{'path':'hello.txt','content':'HUMAN_EDIT'}])
  d=self.wait(tid,'failed');files={f['path']:f['content'] for f in self.bridge('/snapshot',f)['files']};self.assertEqual(files['hello.txt'],'HUMAN_EDIT');self.assertNotIn('src/agent.txt',files);self.assertTrue(any(a['name']=='project/src/agent.txt' for a in d['artifacts']))
 def test_failed_model_run_never_publishes_files(self):
  f=self.pick();tid=self.task(self.project(f),'[test:project-files] [test:fail]');self.ok(call(self.admin,self.base+'/tasks/'+tid+'/run',{'billing_acknowledged':True}));self.wait(tid,'failed');files={f['path']:f['content'] for f in self.bridge('/snapshot',f)['files']};self.assertEqual(files,{'hello.txt':'EXISTING_PROJECT_FILE'})
