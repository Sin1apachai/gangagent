import unittest,time,uuid
from test_api import call,client
import test_organization as support
class Models(unittest.TestCase):
 setUpClass=classmethod(support.Organization.setUpClass.__func__)
 tearDownClass=classmethod(support.Organization.tearDownClass.__func__)
 ok=support.Organization.ok
 def setUp(self):self.wid=self.ok(call(self.admin,'/workspaces',{'name':'Model selection '+uuid.uuid4().hex}))['id'];self.base='/workspaces/'+self.wid
 def body(self,**extra):return {'name':'Model agent','role':'Engineer','instructions':'Model selection fixture only','provider':'codex','enabled':True,**extra}
 def agent(self):return self.ok(call(self.admin,self.base))['agents'][0]
 def test_catalog_is_private_and_cross_provider_values_rejected(self):
  self.assertEqual(call(client(),'/models')[0],401);catalog=self.ok(call(self.admin,'/models'));self.assertIn('gpt-6.1-sol',[c['id'] for c in catalog['codex']]);self.assertNotIn('fable',[c['id'] for c in catalog['claude']])
  email=uuid.uuid4().hex+'@office.local';pw='local-test-password-12345';self.ok(call(self.admin,'/admin/users',{'name':'Private catalog','email':email,'password':pw}));c=client();self.ok(call(c,'/auth/login',{'email':email,'password':pw}));self.assertEqual(self.ok(call(c,'/models')),{'codex':[],'claude':[]})
  for provider,model in [('codex','sonnet'),('claude','gpt-6.1-sol'),('claude','fable'),('claude','best'),('codex','--config'),('codex','gpt-not-in-catalog')]:self.assertEqual(call(self.admin,self.base+'/agents',self.body(provider=provider,model=model))[0],400)
 def test_default_legacy_edit_and_provider_change(self):
  aid=self.ok(call(self.admin,self.base+'/agents',self.body()))['id'];self.assertIsNone(self.agent()['model'])
  self.ok(call(self.admin,self.base+'/agents/'+aid,self.body(version=0,model='gpt-6.1-sol'),'PUT'));self.assertEqual(self.agent()['model'],'gpt-6.1-sol')
  self.ok(call(self.admin,self.base+'/agents/'+aid,self.body(version=1,name='Renamed'),'PUT'));self.assertEqual(self.agent()['model'],'gpt-6.1-sol')
  self.ok(call(self.admin,self.base+'/agents/'+aid,self.body(version=2,provider='claude'),'PUT'));self.assertIsNone(self.agent()['model'])
  self.ok(call(self.admin,self.base+'/agents/'+aid,self.body(version=3,provider='claude',model='sonnet'),'PUT'));self.assertEqual(self.agent()['model'],'sonnet')
 def test_running_task_freezes_model_and_reports_requested_selection(self):
  aid=self.ok(call(self.admin,self.base+'/agents',self.body(model='gpt-6.1-sol')))['id'];tid=self.ok(call(self.admin,self.base+'/tasks',{'title':'Frozen model','description':'Return a fixture report','provider':'codex','agent_id':aid}))['id']
  self.ok(call(self.admin,self.base+'/tasks/'+tid+'/run',{'billing_acknowledged':True}));self.ok(call(self.admin,self.base+'/agents/'+aid,self.body(version=0,model='gpt-6-astra'),'PUT'))
  for _ in range(150):
   d=self.ok(call(self.admin,self.base+'/tasks/'+tid))
   if d['task']['status']=='review':break
   time.sleep(.1)
  else:self.fail('Fixture did not finish')
  self.assertEqual(d['task']['execution_context']['agent']['model'],'gpt-6.1-sol');self.assertEqual(d['runs'][0]['usage_metrics']['requested_model'],'gpt-6.1-sol');self.assertEqual(self.agent()['model'],'gpt-6-astra')
