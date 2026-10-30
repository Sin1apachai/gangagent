import unittest
import test_organization as support
from test_api import call
class Usage(unittest.TestCase):
 setUpClass=classmethod(support.Organization.setUpClass.__func__)
 tearDownClass=classmethod(support.Organization.tearDownClass.__func__)
 setUp=support.Organization.setUp
 get=support.Organization.get;send=support.Organization.send;ok=support.Organization.ok;agent=support.Organization.agent
 detail=support.Organization.detail;start=support.Organization.start;wait=support.Organization.wait
 def test_fixture_metrics_and_lossless_baseline(self):
  aid=self.agent();measurements={}
  for mode in ('pretty','compact'):
   tid=self.ok(self.send('/tasks',{'title':'Identical benchmark','description':'Write result','provider':'codex','agent_id':aid,'context_format':mode}))['id']
   self.ok(self.start(tid));d=self.wait(tid,'review');m=d['runs'][0]['usage_metrics'];measurements[mode]=m
   self.assertEqual(m['source'],'fixture');self.assertNotIn('input_tokens',m);self.assertEqual(m['context_mode'],mode)
   self.assertGreater(m['app_prompt_bytes'],0)
   self.assertEqual(self.send('/tasks',{'title':'Bad mode','description':'','provider':'codex','context_format':'arbitrary'})[0],400)
  self.assertEqual(measurements['pretty']['app_prompt_bytes'],measurements['compact']['baseline_app_prompt_bytes'])
  self.assertGreater(measurements['compact']['saved_formatting_bytes'],0)
  self.assertLess(measurements['compact']['app_prompt_bytes'],measurements['pretty']['app_prompt_bytes'])
