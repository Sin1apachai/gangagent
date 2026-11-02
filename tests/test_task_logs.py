import time,uuid,unittest
from test_api import call,client
import test_organization as support
class TaskLogs(unittest.TestCase):
 setUpClass=classmethod(support.Organization.setUpClass.__func__)
 tearDownClass=classmethod(support.Organization.tearDownClass.__func__)
 ok=support.Organization.ok
 def setUp(self):self.base='/workspaces/'+self.ok(call(self.admin,'/workspaces',{'name':'Task logs '+uuid.uuid4().hex}))['id']
 def task(self,description='Fixture only'):
  tid=self.ok(call(self.admin,self.base+'/tasks',{'title':'Bounded logs','description':description,'provider':'codex'}))['id'];path=self.base+'/tasks/'+tid;self.ok(call(self.admin,path+'/run',{'billing_acknowledged':True}))
  for _ in range(200):
   d=self.ok(call(self.admin,path))
   if d['task']['status']=='review':return path,d
   time.sleep(.1)
  self.fail('No fixture result')
 def test_compact_detail_and_unicode_log_windows(self):
  self.ok(call(self.admin,self.base+'/knowledge',{'title':'Unicode reference','content':'ก🙂A\n'*3000,'source':'Fixture','verified':True}));path,d=self.task();compact=self.ok(call(self.admin,path+'?compact=true'));self.assertTrue(compact['task']['result_truncated']);self.assertLessEqual(len(compact['task']['result']),2000);self.assertEqual(compact['events'],[]);self.assertNotIn('result',compact['runs'][0]);self.assertNotIn('error',compact['runs'][0]);self.assertTrue(all(not t['result'] and t['execution_context'] is None for t in self.ok(call(self.admin,self.base+'?compact=true'))['tasks']))
  route=path+'/runs/'+d['runs'][0]['id']+'/log';before=None;text=''
  for _ in range(20):
   chunk=self.ok(call(self.admin,route+('' if before is None else '?before='+str(before))));self.assertLessEqual(len(chunk['content'].encode()),20000);text=chunk['content']+text
   if chunk['next_before'] is None:break
   before=chunk['next_before']
  else:self.fail('Log pagination did not end')
  self.assertEqual(text,d['runs'][0]['result']);self.assertLessEqual(len(self.ok(call(self.admin,route+'?limit=999999'))['content'].encode()),50000)
 def test_event_cursor_has_no_duplicate_or_missing_events(self):
  path,d=self.task('[test:many-events]');before=None;events=[]
  for _ in range(10):
   page=self.ok(call(self.admin,path+'/history-events'+('' if before is None else '?before='+str(before))));self.assertLessEqual(len(page['events']),20);events.extend(page['events'])
   if page['next_before'] is None:break
   before=page['next_before']
  self.assertEqual([e['id'] for e in events],sorted([e['id'] for e in d['events']],reverse=True));self.assertGreaterEqual(len(events),45)
 def test_log_history_and_run_scope_are_authorized(self):
  path,d=self.task();route=path+'/runs/'+d['runs'][0]['id']+'/log';self.assertEqual(call(client(),route)[0],401);self.assertEqual(call(client(),path+'/history-events')[0],401);self.assertEqual(call(self.admin,path+'/runs/'+str(uuid.uuid4())+'/log')[0],404)
  email=uuid.uuid4().hex+'@office.local';password='fixture-log-password-2026';self.ok(call(self.admin,'/admin/users',{'name':'Outsider','email':email,'password':password}));other=client();self.ok(call(other,'/auth/login',{'email':email,'password':password}));self.assertEqual(call(other,route)[0],403);self.assertEqual(call(other,path+'/history-events')[0],403)
  self.ok(call(self.admin,path,method='DELETE'));self.assertEqual(call(self.admin,route)[0],404);self.assertEqual(call(self.admin,path+'/history-events')[0],404)
