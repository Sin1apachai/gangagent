"""Runner control API and standards. No Docker Runner is enabled in this suite."""
import time,uuid,unittest,concurrent.futures
from test_api import call,client
import test_organization as support
class RuntimeAPI(unittest.TestCase):
 setUpClass=classmethod(support.Organization.setUpClass.__func__)
 tearDownClass=classmethod(support.Organization.tearDownClass.__func__)
 ok=support.Organization.ok
 def setUp(self):self.base='/workspaces/'+self.ok(call(self.admin,'/workspaces',{'name':'Runtime API '+uuid.uuid4().hex}))['id'];self.tasks=[]
 def tearDown(self):
  for tid in self.tasks:
   data=call(self.admin,self.base+'/tasks/'+tid+'/runtime')
   if data[0]==200:
    for job in data[1]['jobs']:
     if job['status']=='queued':call(self.admin,self.base+'/runtime/'+job['id']+'/stop',{})
 def source(self,enabled=False,provider='codex'):
  tid=self.ok(call(self.admin,self.base+'/tasks',{'title':'Runtime source','description':'[test:node-preview]','provider':provider,'runtime_enabled':enabled}))['id'];self.tasks.append(tid);path=self.base+'/tasks/'+tid;self.ok(call(self.admin,path+'/run',{'billing_acknowledged':True}))
  for _ in range(200):
   d=self.ok(call(self.admin,path))
   if d['task']['status']=='review':return tid,d
   time.sleep(.1)
  self.fail('Fixture did not produce source')
 def test_standard_is_authenticated_global_and_frozen_for_both_providers(self):
  self.assertEqual(call(client(),'/standards')[0],401);rows=self.ok(call(self.admin,'/standards'));self.assertEqual(rows[0]['id'],'application-runtime');self.assertIn('office-run.json',rows[0]['instructions']);self.assertIn('0.0.0.0',rows[0]['instructions'])
  for provider in ['codex','claude']:
   tid,d=self.source(provider=provider);s=d['task']['execution_context']['standards'][0];self.assertEqual(s['checksum'],rows[0]['checksum']);self.assertIn('Application runtime standard v1',d['task']['result'])
 def test_launch_requires_ack_and_completed_source(self):
  tid=self.ok(call(self.admin,self.base+'/tasks',{'title':'Not run','description':'No source','provider':'codex'}))['id'];route=self.base+'/tasks/'+tid+'/runtime';self.assertEqual(call(self.admin,route,{'acknowledged':True})[0],400)
  tid,_=self.source();route=self.base+'/tasks/'+tid+'/runtime';self.assertEqual(call(self.admin,route,{'acknowledged':False})[0],400);self.assertEqual(self.ok(call(self.admin,route))['jobs'],[])
 def test_duplicate_launch_is_idempotent_and_acceptance_waits_for_runner(self):
  tid,_=self.source();route=self.base+'/tasks/'+tid+'/runtime'
  with concurrent.futures.ThreadPoolExecutor(2) as pool:rows=list(pool.map(lambda _:self.ok(call(self.admin,route,{'acknowledged':True})),range(2)))
  self.assertEqual(rows[0]['id'],rows[1]['id']);jobs=self.ok(call(self.admin,route))['jobs'];self.assertEqual(len(jobs),1);self.assertEqual(jobs[0]['status'],'queued');self.assertTrue(self.ok(call(self.admin,self.base+'/tasks/'+tid))['task']['runtime_enabled']);self.assertEqual(call(self.admin,self.base+'/tasks/'+tid+'/review',{'accept':True,'feedback':'Must not bypass Runner'})[0],409)
 def test_auto_mode_enqueues_once_and_offline_queue_can_be_stopped(self):
  tid,_=self.source(enabled=True);route=self.base+'/tasks/'+tid+'/runtime'
  for _ in range(80):
   jobs=self.ok(call(self.admin,route))['jobs']
   if jobs:break
   time.sleep(.1)
  self.assertEqual(len(jobs),1);jid=jobs[0]['id'];self.ok(call(self.admin,self.base+'/runtime/'+jid+'/stop',{}));self.assertEqual(self.ok(call(self.admin,route))['jobs'][0]['status'],'stopped');time.sleep(2.1);self.assertEqual(len(self.ok(call(self.admin,route))['jobs']),1)
 def test_ports_are_unique_and_capacity_is_bounded(self):
  ids=[];ports=[]
  for _ in range(3):
   tid,_=self.source();jid=self.ok(call(self.admin,self.base+'/tasks/'+tid+'/runtime',{'acknowledged':True}))['id'];ids.append(jid);ports.append(self.ok(call(self.admin,self.base+'/tasks/'+tid+'/runtime'))['jobs'][0]['port'])
  self.assertEqual(len(set(ports)),3);self.assertTrue(all(19000<=p<=19099 for p in ports));tid,_=self.source();self.assertEqual(call(self.admin,self.base+'/tasks/'+tid+'/runtime',{'acknowledged':True})[0],409)
 def test_runtime_inventory_logs_and_stop_are_workspace_scoped(self):
  tid,_=self.source();path=self.base+'/tasks/'+tid+'/runtime';jid=self.ok(call(self.admin,path,{'acknowledged':True}))['id'];log=self.base+'/runtime/'+jid+'/logs';stop=self.base+'/runtime/'+jid+'/stop';self.assertEqual(call(client(),path)[0],401);self.assertEqual(call(client(),log)[0],401)
  email=uuid.uuid4().hex+'@office.local';pw='runtime-fixture-password-2026';self.ok(call(self.admin,'/admin/users',{'name':'Outsider','email':email,'password':pw}));other=client();self.ok(call(other,'/auth/login',{'email':email,'password':pw}));self.assertEqual(call(other,path)[0],403);self.assertEqual(call(other,log)[0],403);self.assertEqual(call(other,stop,{})[0],403)
  wid=self.ok(call(self.admin,'/workspaces',{'name':'Other runtime scope'}))['id'];self.assertEqual(call(self.admin,'/workspaces/'+wid+'/runtime/'+jid+'/logs')[0],404);self.assertEqual(call(self.admin,'/workspaces/'+wid+'/runtime/'+jid+'/stop',{})[0],404)
