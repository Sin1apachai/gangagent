"""Persistent project code; Task data stays in Postgres/internal artifact storage."""
import time,uuid,unittest,concurrent.futures,os
from pathlib import Path
from test_api import call,client,BASE
import test_organization as support
class WorkspaceCode(unittest.TestCase):
 setUpClass=classmethod(support.Organization.setUpClass.__func__)
 tearDownClass=classmethod(support.Organization.tearDownClass.__func__)
 ok=support.Organization.ok
 def name(self):return 'Code '+uuid.uuid4().hex
 def workspace(self,name=None):return self.ok(call(self.admin,'/workspaces',{'name':name or self.name()}))
 def project(self,w,name='Purchase'):return self.ok(call(self.admin,'/workspaces/'+w['id']+'/projects',{'name':name,'description':'Persistent code'}))['id']
 def create(self,w,pid,markers='[test:node-preview]'):
  base='/workspaces/'+w['id'];tid=self.ok(call(self.admin,base+'/tasks',{'title':'Program edit','description':'[test:project-code] '+markers,'provider':'codex','project_id':pid}))['id'];p=base+'/tasks/'+tid;self.ok(call(self.admin,p+'/run',{'billing_acknowledged':True}));return p
 def wait(self,p,status='review'):
  for _ in range(300):
   d=self.ok(call(self.admin,p))
   if d['task']['status']==status:return d
   if d['task']['status']=='failed' and status!='failed':self.fail(str(d['task']['error']))
   time.sleep(.1)
  self.fail('Unexpected task state '+str(d['task']['status']))
 def synced(self,p,state='synced'):
  for _ in range(160):
   d=self.ok(call(self.admin,p+'/code-folder'))
   if d['session'] and d['session']['state']==state:return d
   time.sleep(.1)
  self.fail(str(d))
 def disk(self,w,project='purchase'):return Path('/exports')/w['code_directory'].removeprefix('workspace/')/project
 def test_concurrent_case_insensitive_duplicate_is_rejected(self):
  name=self.name()
  with concurrent.futures.ThreadPoolExecutor(2) as pool:r=list(pool.map(lambda n:call(self.admin,'/workspaces',{'name':n}),[name,'  '+name.upper()+'  ']))
  self.assertEqual(sorted(v[0] for v in r),[200,409])
 def test_directory_alias_collision_and_empty_key_are_rejected(self):
  name='path-'+uuid.uuid4().hex;self.workspace(name);self.assertEqual(call(self.admin,'/workspaces',{'name':name.replace('-',' ',1)})[0],409)
  for n in ['..','///','  ']:self.assertEqual(call(self.admin,'/workspaces',{'name':n})[0],400)
 def test_rename_collision_and_stable_directory(self):
  a,b=self.workspace(),self.workspace();p='/workspaces/'+a['id'];self.assertEqual(call(self.admin,p,{'name':b['name'],'version':0},'PUT')[0],409);self.ok(call(self.admin,p,{'name':self.name(),'version':0},'PUT'));self.assertEqual(self.ok(call(self.admin,p))['code_directory'],a['code_directory'])
 def test_trashed_name_remains_reserved(self):
  w=self.workspace();p='/workspaces/'+w['id'];self.ok(call(self.admin,p,method='DELETE'));self.assertEqual(call(self.admin,'/workspaces',{'name':w['name'].lower()})[0],409);self.ok(call(self.admin,p+'/restore',{}))
 def test_code_is_in_project_root_not_task_or_run_folders(self):
  w=self.workspace();pid=self.project(w);p=self.create(w,pid);d=self.wait(p);inventory=self.synced(p);root=self.disk(w);self.assertEqual(inventory['path'],w['code_directory']+'/purchase');self.assertIn('createApp',(root/'server.mjs').read_text());self.assertTrue((root/'package.json').is_file());self.assertFalse((root/'tasks').exists());self.assertFalse((root.parent/'tasks').exists());self.assertFalse((root/'runs').exists());self.assertFalse((root/'result.md').exists());self.assertIn('workspace-project-code',[s['id'] for s in d['task']['execution_context']['standards']])
 def test_later_task_reads_host_edits_and_reuses_same_program(self):
  w=self.workspace();pid=self.project(w);p=self.create(w,pid);self.wait(p);self.synced(p);root=self.disk(w);(root/'server.mjs').write_text('Host change must be read by next task');(root/'manual.txt').write_text('Manual source file');p2=self.create(w,pid,'[test:node-preview] [test:project-observe]');d=self.wait(p2);self.synced(p2);self.assertEqual((root/'server.mjs').read_text(),'Host change must be read by next task');a=next(a for a in d['artifacts'] if a['name']=='code/server.mjs');self.assertEqual(self.admin.open(BASE+'/api'+p2+'/artifacts/'+a['id']).read().decode(),'Host change must be read by next task');self.assertEqual((root/'manual.txt').read_text(),'Manual source file')
 def test_task_reports_do_not_enter_program_folder(self):
  w=self.workspace();pid=self.project(w);p=self.create(w,pid,'[test:knowledge-doc]');d=self.wait(p);self.synced(p);root=self.disk(w);self.assertFalse((root/'requirements.md').exists());self.assertTrue(any(a['name']=='requirements.md' for a in d['artifacts']));self.assertFalse((root.parent/'tasks').exists())
 def test_live_code_and_conflict_preserve_host_change(self):
  w=self.workspace();pid=self.project(w);p=self.create(w,pid,'[test:node-preview] [test:project-conflict]');root=self.disk(w)
  for _ in range(100):
   if (root/'server.mjs').exists():break
   time.sleep(.1)
  else:self.fail('Live program update missing')
  self.assertEqual(self.ok(call(self.admin,p))['task']['status'],'running');(root/'server.mjs').write_text('HOST CHANGE');self.wait(p);self.synced(p,'conflict');self.assertEqual((root/'server.mjs').read_text(),'HOST CHANGE')
 def test_unowned_project_folder_is_preserved(self):
  w=self.workspace();pid=self.project(w);root=self.disk(w);root.parent.mkdir(exist_ok=True);root.mkdir();(root/'keep.txt').write_text('keep');p=self.create(w,pid);self.wait(p,'failed');self.assertEqual((root/'keep.txt').read_text(),'keep');self.assertFalse((root/'.office-project.json').exists())
 def test_project_symlink_is_rejected(self):
  w=self.workspace();pid=self.project(w);root=self.disk(w);root.parent.mkdir(exist_ok=True);target=Path('/exports')/('sentinel-'+uuid.uuid4().hex);target.mkdir();os.symlink(target,root);p=self.create(w,pid);self.wait(p,'failed');self.assertEqual(list(target.iterdir()),[])
 def test_code_folder_is_workspace_scoped(self):
  w=self.workspace();pid=self.project(w);p=self.create(w,pid);d=self.wait(p);self.assertEqual(call(client(),p+'/code-folder')[0],401);other=self.workspace();self.assertEqual(call(self.admin,'/workspaces/'+other['id']+'/tasks/'+d['task']['id']+'/code-folder')[0],404)
