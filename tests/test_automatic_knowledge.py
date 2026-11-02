"""Automatic acceptance memory: fixture-only, no provider requests."""
import concurrent.futures,time,uuid,unittest
from test_api import call,client
import test_organization as support
class AutomaticKnowledge(unittest.TestCase):
 setUpClass=classmethod(support.Organization.setUpClass.__func__)
 tearDownClass=classmethod(support.Organization.tearDownClass.__func__)
 ok=support.Organization.ok
 def setUp(self):
  self.base='/workspaces/'+self.ok(call(self.admin,'/workspaces',{'name':'Auto knowledge '+uuid.uuid4().hex}))['id']
 def snapshot(self):return self.ok(call(self.admin,self.base))
 def project(self):return self.ok(call(self.admin,self.base+'/projects',{'name':'Memory scope','description':'Fixture project'}))['id']
 def task(self,project=None,v2=False,document=True):
  tid=self.ok(call(self.admin,self.base+'/tasks',{'title':'Approved requirements','description':('[test:knowledge-doc]' if document else 'Summary only')+(' [test:knowledge-v2]' if v2 else ''),'provider':'codex','project_id':project}))['id'];path=self.base+'/tasks/'+tid
  self.ok(call(self.admin,path+'/run',{'billing_acknowledged':True}))
  for _ in range(200):
   d=self.ok(call(self.admin,path))
   if d['task']['status']=='review':return path
   time.sleep(.1)
  self.fail('Fixture did not reach review')
 def accept(self,path):return self.ok(call(self.admin,path+'/review',{'accept':True,'feedback':'Fixture evidence checked'}))['knowledge']
 def history(self,id):return self.ok(call(self.admin,self.base+'/knowledge/'+id+'/history'))
 def test_create_update_history_idempotence_and_old_run_cannot_rollback(self):
  project=self.project();old=self.task(project);first=self.accept(old);self.assertEqual(first['action'],'created');id=first['id'];note=self.snapshot()['knowledge'][0]
  self.assertTrue(note['verified']);self.assertIn('APPROVED_VERSION_ONE',note['content']);self.assertEqual(len(self.history(id)),1)
  new=self.task(project,True);updated=self.accept(new);self.assertEqual(updated,{'id':id,'action':'updated'});history=self.history(id);self.assertEqual(len(history),2);self.assertIn('APPROVED_VERSION_TWO',history[0]['content']);self.assertIn('APPROVED_VERSION_ONE',history[1]['content'])
  for path in [old,new]:self.assertEqual(self.ok(call(self.admin,path+'/knowledge',{}))['action'],'unchanged')
  self.assertEqual(len(self.history(id)),2)
  note=self.snapshot()['knowledge'][0];self.ok(call(self.admin,self.base+'/knowledge/'+id,{'title':note['title'],'content':'Human correction','source':'Owner review','verified':True,'version':note['version']},'PUT'))
  self.assertEqual(self.ok(call(self.admin,new+'/knowledge',{}))['action'],'unchanged');self.assertEqual(self.snapshot()['knowledge'][0]['content'],'Human correction');self.assertEqual(len(self.history(id)),3)
 def test_rejection_no_save_and_duplicate_acceptance_is_atomic(self):
  path=self.task();self.assertEqual(self.snapshot()['knowledge'],[]);self.assertEqual(call(self.admin,path+'/knowledge',{})[0],400)
  self.ok(call(self.admin,path+'/review',{'accept':False,'feedback':'Revise first'}));self.assertEqual(self.snapshot()['knowledge'],[])
  self.ok(call(self.admin,path+'/run',{'billing_acknowledged':True}))
  for _ in range(200):
   if self.ok(call(self.admin,path))['task']['status']=='review':break
   time.sleep(.1)
  with concurrent.futures.ThreadPoolExecutor(2) as pool:results=list(pool.map(lambda _:call(self.admin,path+'/review',{'accept':True,'feedback':'Checked'})[0],range(2)))
  self.assertEqual(sorted(results),[200,409]);notes=self.snapshot()['knowledge'];self.assertEqual(len(notes),1);self.assertEqual(len(self.history(notes[0]['id'])),1)
 def test_project_isolation_summaries_and_deleted_memory(self):
  p1=self.project();p2=self.project();one=self.accept(self.task(p1));two=self.accept(self.task(p2));self.assertNotEqual(one['id'],two['id'])
  a=self.accept(self.task(p1,document=False));b=self.accept(self.task(p1,document=False));self.assertNotEqual(a['id'],b['id'])
  self.ok(call(self.admin,self.base+'/knowledge/'+one['id'],method='DELETE'));three=self.accept(self.task(p1,True));self.assertNotEqual(three['id'],one['id']);self.assertEqual(len(self.snapshot()['knowledge']),4);self.assertEqual(len(self.history(one['id'])),2);self.assertEqual(call(self.admin,self.base+'/knowledge/'+one['id']+'/restore',{})[0],409);self.assertEqual(len(self.history(one['id'])),2)
 def test_history_access_scoped_and_manual_notes_preserved(self):
  manual=self.ok(call(self.admin,self.base+'/knowledge',{'title':'Approved requirements','content':'Do not merge by title','source':'Owner','verified':True}))['id'];auto=self.accept(self.task());self.assertNotEqual(manual,auto['id']);self.assertEqual(self.history(manual)[0]['content'],'Do not merge by title')
  route=self.base+'/knowledge/'+auto['id']+'/history';self.assertEqual(call(client(),route)[0],401)
  other=self.ok(call(self.admin,'/workspaces',{'name':'Other scope'}))['id'];self.assertEqual(call(self.admin,'/workspaces/'+other+'/knowledge/'+auto['id']+'/history')[0],404)
  email=uuid.uuid4().hex+'@office.local';password='fixture-memory-password-2026';self.ok(call(self.admin,'/admin/users',{'name':'No access','email':email,'password':password}));member=client();self.ok(call(member,'/auth/login',{'email':email,'password':password}));self.assertEqual(call(member,route)[0],403)
 def test_newer_run_wins_even_when_older_is_accepted_later(self):
  project=self.project();old=self.task(project);new=self.task(project,True);latest=self.accept(new);self.assertEqual(self.accept(old),{'id':latest['id'],'action':'unchanged'});self.assertIn('APPROVED_VERSION_TWO',self.snapshot()['knowledge'][0]['content']);self.assertEqual(len(self.history(latest['id'])),1)
