"""Workspace names and exported code; only ephemeral /exports test volume is writable."""
import time,uuid,unittest,concurrent.futures,json,os
from pathlib import Path
from test_api import call,client
import test_organization as support
class WorkspaceCode(unittest.TestCase):
 setUpClass=classmethod(support.Organization.setUpClass.__func__)
 tearDownClass=classmethod(support.Organization.tearDownClass.__func__)
 ok=support.Organization.ok
 def name(self):return 'Code '+uuid.uuid4().hex
 def workspace(self,name=None):return self.ok(call(self.admin,'/workspaces',{'name':name or self.name()}))
 def source(self,w):
  base='/workspaces/'+w['id'];tid=self.ok(call(self.admin,base+'/tasks',{'title':'Real code export','description':'[test:node-preview]','provider':'codex'}))['id'];p=base+'/tasks/'+tid;self.ok(call(self.admin,p+'/run',{'billing_acknowledged':True}))
  for _ in range(200):
   d=self.ok(call(self.admin,p))
   if d['task']['status']=='review':return p,d
   time.sleep(.1)
  self.fail('Fixture source did not finish')
 def exported(self,p,run,status='ready'):
  for _ in range(150):
   data=self.ok(call(self.admin,p+'/code-folder'));row=next((r for r in data['runs'] if r['run_id']==run),None)
   if row and row['status']==status:return row,data
   time.sleep(.1)
  self.fail('Export did not reach expected state: '+str(data))
 def disk(self,row):
  self.assertTrue(row['relative_path'].startswith('workspace/'));return Path('/exports')/row['relative_path'].removeprefix('workspace/')
 def test_concurrent_case_insensitive_duplicate_is_rejected(self):
  name=self.name()
  with concurrent.futures.ThreadPoolExecutor(2) as pool:r=list(pool.map(lambda n:call(self.admin,'/workspaces',{'name':n}),[name,'  '+name.upper()+'  ']))
  self.assertEqual(sorted(v[0] for v in r),[200,409]);self.assertIn('ถูกใช้แล้ว',next(v[1]['error'] for v in r if v[0]==409))
 def test_directory_alias_collision_and_empty_key_are_rejected(self):
  name='path-'+uuid.uuid4().hex;self.workspace(name);self.assertEqual(call(self.admin,'/workspaces',{'name':name.replace('-', ' ',1)})[0],409)
  for name in ['..','///','  ']:self.assertEqual(call(self.admin,'/workspaces',{'name':name})[0],400)
 def test_rename_collision_and_stable_directory(self):
  a,b=self.workspace(),self.workspace();base='/workspaces/'+a['id'];self.assertEqual(call(self.admin,base,{'name':b['name'].upper(),'version':0},'PUT')[0],409)
  new=self.name();self.ok(call(self.admin,base,{'name':new,'version':0},'PUT'));data=self.ok(call(self.admin,base));self.assertEqual(data['name'],new);self.assertEqual(data['code_directory'],a['code_directory']);self.assertEqual(call(self.admin,'/workspaces',{'name':a['name']})[0],409)
 def test_trashed_name_is_reserved_and_restore_succeeds(self):
  w=self.workspace();p='/workspaces/'+w['id'];self.ok(call(self.admin,p,method='DELETE'));self.assertEqual(call(self.admin,'/workspaces',{'name':w['name'].lower()})[0],409);self.ok(call(self.admin,p+'/restore',{}))
 def test_real_registered_code_export_and_global_standard(self):
  w=self.workspace();p,d=self.source(w);run=d['task']['current_run_id'];row,data=self.exported(p,run);root=self.disk(row);self.assertEqual(data['root'],w['code_directory']);self.assertGreaterEqual(row['files'],6);self.assertIn('createApp',(root/'server.mjs').read_text());self.assertEqual(json.loads((root/'office-run.json').read_text())['runtime'],'node');self.assertFalse((root/'inputs').exists());self.assertFalse((root/'references').exists());self.assertFalse((root/'result.md').exists());marker=json.loads((root/'.office-export.json').read_text());self.assertEqual(marker['run_id'],run);self.assertEqual(marker['workspace_id'],w['id']);self.assertIn('workspace-code-export',[s['id'] for s in d['task']['execution_context']['standards']]);self.assertTrue((root.parent.parent.parent.parent/'.office-workspace.json').exists())
 def test_revision_exports_new_snapshot_and_preserves_edited_old_copy(self):
  w=self.workspace();p,d=self.source(w);old=d['task']['current_run_id'];row,_=self.exported(p,old);root=self.disk(row);(root/'server.mjs').write_text('Host edit must survive')
  self.ok(call(self.admin,p+'/review',{'accept':False,'feedback':'Produce a new complete source snapshot'}));self.ok(call(self.admin,p+'/run',{'billing_acknowledged':True}))
  for _ in range(200):
   d=self.ok(call(self.admin,p))
   if d['task']['status']=='review' and d['task']['current_run_id']!=old:break
   time.sleep(.1)
  new=d['task']['current_run_id'];self.assertNotEqual(old,new);row,_=self.exported(p,new);self.assertIn('createApp',(self.disk(row)/'server.mjs').read_text());self.assertEqual((root/'server.mjs').read_text(),'Host edit must survive')
 def test_existing_unowned_folder_is_not_overwritten(self):
  name='foreign-'+uuid.uuid4().hex;root=Path('/exports')/name;root.mkdir();(root/'keep.txt').write_text('Do not overwrite');w=self.workspace(name);p,d=self.source(w);row,_=self.exported(p,d['task']['current_run_id'],'failed');self.assertIn('not owned',row['error']);self.assertEqual((root/'keep.txt').read_text(),'Do not overwrite');self.assertFalse((root/'.office-workspace.json').exists())
 def test_export_folder_symlink_cannot_escape(self):
  name='symlink-'+uuid.uuid4().hex;target=Path('/exports')/('sentinel-'+uuid.uuid4().hex);target.mkdir();os.symlink(target,Path('/exports')/name);w=self.workspace(name);p,d=self.source(w);row,_=self.exported(p,d['task']['current_run_id'],'failed');self.assertIn('symlink',row['error']);self.assertEqual(list(target.iterdir()),[])
 def test_code_folder_is_workspace_scoped(self):
  w=self.workspace();p,d=self.source(w);self.assertEqual(call(client(),p+'/code-folder')[0],401);other=self.workspace();self.assertEqual(call(self.admin,'/workspaces/'+other['id']+'/tasks/'+d['task']['id']+'/code-folder')[0],404)
  c=client();email=uuid.uuid4().hex+'@office.local';pw='code-export-test-password';self.ok(call(self.admin,'/admin/users',{'name':'Export outsider','email':email,'password':pw}));self.ok(call(c,'/auth/login',{'email':email,'password':pw}));self.assertEqual(call(c,p+'/code-folder')[0],403);self.assertEqual(call(c,'/workspaces',{'name':w['name']})[0],409)
