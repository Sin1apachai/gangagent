import unittest,time,copy,uuid
from test_api import call,client
import test_organization as support
class Monitoring(unittest.TestCase):
 setUpClass=classmethod(support.Organization.setUpClass.__func__)
 tearDownClass=classmethod(support.Organization.tearDownClass.__func__)
 ok=support.Organization.ok
 def get(self):return self.ok(call(self.admin,'/admin/resources'))
 def setUp(self):self.original=copy.deepcopy(self.get()['config']['settings'])
 def tearDown(self):
  c=self.get()['config'];self.ok(call(self.admin,'/admin/resources/settings',{'version':c['version'],'settings':self.original},'PUT'))
 def ready(self):
  for _ in range(150):
   d=self.get()
   if d['state'] and not d['state']['stale'] and isinstance(d['state']['sample']['vm']['cpu_percent'],(int,float)):return d
   time.sleep(.1)
  self.fail('No fresh Linux resource sample')
 def test_resource_values_are_measured_and_scoped(self):
  d=self.ready();s=d['state']['sample'];self.assertGreater(s['vm']['memory_total_bytes'],0);self.assertLessEqual(s['vm']['memory_available_bytes'],s['vm']['memory_total_bytes']);self.assertGreaterEqual(s['vm']['cpu_percent'],0);self.assertLessEqual(s['vm']['cpu_percent'],100)
  self.assertGreater(s['data_disk']['total_bytes'],0);self.assertGreaterEqual(s['data_disk']['available_bytes'],0);self.assertIn('not physical macOS',d['scope']);self.assertEqual(d['sample_interval_seconds'],5)
  self.assertEqual(s['redis']['limit_bytes'],128*1024*1024);self.assertGreater(s['redis']['used_bytes'],0)
  self.assertTrue(any(w['online'] and w['resources'].get('memory_limit_bytes') for w in s['workers']))
 def test_non_admin_cannot_read_change_or_acknowledge(self):
  self.assertEqual(call(client(),'/admin/resources')[0],401)
  email='monitor-'+uuid.uuid4().hex+'@office.local';pw='local-test-password-12345'
  self.ok(call(self.admin,'/admin/users',{'name':'Monitoring member','email':email,'password':pw}));other=client();self.ok(call(other,'/auth/login',{'email':email,'password':pw}));config=self.get()['config']
  self.assertEqual(call(other,'/admin/resources')[0],403)
  self.assertEqual(call(other,'/admin/resources/settings',config,'PUT')[0],403)
  self.assertEqual(call(other,'/admin/resources/notifications/read',{'all':True})[0],403)
 def test_threshold_validation_and_version_conflicts(self):
  c=self.get()['config']
  variants=[]
  for value in (0,100,-1):
   s=copy.deepcopy(c['settings']);s['rules']['vm_memory']['threshold_percent']=value;variants.append(s)
  for value in (0,301):
   s=copy.deepcopy(c['settings']);s['hold_seconds']=value;variants.append(s)
  s=copy.deepcopy(c['settings']);del s['rules']['vm_cpu'];variants.append(s)
  s=copy.deepcopy(c['settings']);s['rules']['arbitrary_host_path']={'enabled':True,'threshold_percent':90};variants.append(s)
  for s in variants:self.assertEqual(call(self.admin,'/admin/resources/settings',{'version':c['version'],'settings':s},'PUT')[0],400)
  self.ok(call(self.admin,'/admin/resources/settings',c,'PUT'));self.assertEqual(call(self.admin,'/admin/resources/settings',c,'PUT')[0],409)
 def test_warning_is_held_deduplicated_read_and_recovers(self):
  d=self.ready();self.ok(call(self.admin,'/admin/resources/notifications/read',{'all':True}));s=copy.deepcopy(d['config']['settings'])
  key='vm_memory' if d['state']['sample']['vm']['memory_percent']>1 else 'data_disk'
  for r in s['rules'].values():r['enabled']=False
  s['rules'][key]={'enabled':True,'threshold_percent':1};s['hold_seconds']=5
  before={n['id'] for n in d['notifications']};self.ok(call(self.admin,'/admin/resources/settings',{'version':d['config']['version'],'settings':s},'PUT'))
  warning=None
  for _ in range(150):
   current=self.get();new=[n for n in current['notifications'] if n['id'] not in before and n['resource_key']==key and n['kind']=='warning']
   if new:warning=new[0];break
   time.sleep(.15)
  self.assertIsNotNone(warning);self.assertFalse(warning['read']);self.assertGreaterEqual(current['unread_count'],1)
  time.sleep(6);current=self.get();self.assertEqual(len([n for n in current['notifications'] if n['resource_key']==key and n['kind']=='warning' and n['resolved_at'] is None]),1)
  self.ok(call(self.admin,'/admin/resources/notifications/read',{'ids':[warning['id']]}));self.assertTrue(next(n for n in self.get()['notifications'] if n['id']==warning['id'])['read'])
  c=self.get()['config'];s['rules'][key]['enabled']=False;self.ok(call(self.admin,'/admin/resources/settings',{'version':c['version'],'settings':s},'PUT'))
  for _ in range(100):
   current=self.get();recovered=[n for n in current['notifications'] if n['resource_key']==key and n['kind']=='recovery' and n['reason']=='rule_disabled']
   if recovered:break
   time.sleep(.15)
  self.assertTrue(recovered);self.assertIsNotNone(next(n for n in current['notifications'] if n['id']==warning['id'])['resolved_at'])
