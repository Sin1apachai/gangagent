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
 def note(self,title,content,verified=True):
  return self.ok(self.send('/knowledge',{'title':title,'content':content,'source':'Usage test','verified':verified}))['id']
 def focused_task(self,description,mode='focused'):
  tid=self.ok(self.send('/tasks',{'title':'Focused retrieval','description':description,'provider':'codex','context_format':mode}))['id'];self.ok(self.start(tid));return self.wait(tid,'review')
 def test_focused_relevance_and_workspace_verified_scope(self):
  self.note('Cafeteria archive','CAFETERIA_UNUSED '+('Lunch parking guests. '*60))
  target=self.note('Orion deployment','ORION_REQUIRED requires port 8123')
  self.note('Orion confidential draft','UNVERIFIED_SECRET',False)
  foreign=self.ok(call(self.admin,'/workspaces',{'name':'Foreign scoped notes'}))['id']
  self.ok(call(self.admin,'/workspaces/'+foreign+'/knowledge',{'title':'Orion deployment','content':'FOREIGN_SECRET','source':'','verified':True}))
  d=self.focused_task('Orion deployment requires verified details');m=d['runs'][0]['usage_metrics'];result=d['task']['result']
  self.assertIn('ORION_REQUIRED',result);self.assertNotIn('CAFETERIA_UNUSED',result);self.assertNotIn('UNVERIFIED_SECRET',result);self.assertNotIn('FOREIGN_SECRET',result)
  self.assertEqual(m['knowledge_selected'],1);self.assertEqual(m['knowledge_candidates'],2);self.assertIn(target,m['knowledge_sources']);self.assertGreater(m['context_saved_bytes'],0)
 def test_focused_fallback_and_pinned_document(self):
  pinned=self.note('Catering archive','PIN_REQUIRED_MARKER');self.note('Other archive','SECOND_FALLBACK_MARKER')
  d=self.focused_task('Unmatchable zephyr');self.assertIn('SECOND_FALLBACK_MARKER',d['task']['result']);self.assertIn('fallback',d['runs'][0]['usage_metrics']['knowledge_selection'])
  d=self.focused_task('Unmatchable zephyr [[knowledge:'+pinned+']]');self.assertIn('PIN_REQUIRED_MARKER',d['task']['result']);self.assertEqual(d['runs'][0]['usage_metrics']['knowledge_selected'],1)
 def test_focused_finds_document_older_than_twenty(self):
  target=self.note('Orion required record','OLDER_RELEVANT_MARKER')
  for n in range(21):self.note('Cafeteria '+str(n),'Unrelated parking schedule')
  d=self.focused_task('Orion required record');self.assertIn('OLDER_RELEVANT_MARKER',d['task']['result']);self.assertIn(target,d['runs'][0]['usage_metrics']['knowledge_sources'])
 def test_plan_focused_handoff_and_invalid_handoff_fallback(self):
  for invalid in (False,True):
   a=self.agent('Producer');b=self.agent('Reviewer')
   wf=self.ok(self.send('/workflows',{'title':'Handoff trial','description':'Evidence','steps':[{'title':'Produce','description':'[test:handoff-invalid]' if invalid else '[test:handoff]','agent_id':a,'depends_on':[],'required_files':['result.md']},{'title':'Review','description':'Check accepted evidence','agent_id':b,'depends_on':[0],'required_files':['result.md']}]}))['id']
   pid=self.ok(self.send('/workflows/'+wf+'/instantiate',{'version':0,'goal':'Handoff test','request_id':__import__('uuid').uuid4().hex}))['plan_id']
   self.assertEqual(self.send('/plans/'+pid+'/approve',{'version':0,'billing_acknowledged':True,'context_format':'bad'})[0],400)
   tids=self.ok(self.send('/plans/'+pid+'/approve',{'version':0,'billing_acknowledged':True,'context_format':'focused'}))['tasks']
   d=self.wait(tids[0],'review');self.ok(self.send('/tasks/'+tids[0]+'/review',{'accept':True,'feedback':'Accepted test evidence'}));d=self.wait(tids[1],'review')
   self.assertEqual(d['task']['context_format'],'focused');self.assertEqual(d['runs'][0]['usage_metrics']['handoffs_used'],0 if invalid else 1)
 def test_context_policy_versions_auth_and_cancel_guard(self):
  tid=self.ok(self.send('/tasks',{'title':'Mode switch','description':'Any','provider':'codex'}))['id'];path='/tasks/'+tid+'/context'
  self.assertEqual(call(__import__('test_api').client(),self.base+path,{'version':0,'context_format':'focused'},'PUT')[0],401)
  self.assertEqual(self.send(path,{'version':0,'context_format':'invalid'},'PUT')[0],400)
  self.ok(self.send(path,{'version':0,'context_format':'focused'},'PUT'))
  self.assertEqual(self.send(path,{'version':0,'context_format':'compact'},'PUT')[0],409)
  d=self.detail(tid);self.assertEqual(d['task']['context_format'],'focused');self.assertEqual(d['task']['attempts'],0)
  self.ok(self.send('/tasks/'+tid+'/cancel',{}));d=self.detail(tid)
  self.assertEqual(self.send(path,{'version':d['task']['version'],'context_format':'compact'},'PUT')[0],409)
 def test_missing_or_foreign_required_note_fails_without_model_attempt(self):
  import uuid
  tid=self.ok(self.send('/tasks',{'title':'Pinned unavailable','description':'[[knowledge:'+str(uuid.uuid4())+']]','provider':'codex','context_format':'focused'}))['id']
  self.ok(self.start(tid));d=self.wait(tid,'failed');self.assertEqual(d['task']['attempts'],0);self.assertIn('No AI call',d['task']['error']);self.assertEqual(d['runs'][0]['usage_metrics']['context_blocked'],1)
 def test_plan_usage_fixture_never_fabricates_provider_totals(self):
  aid=self.agent();wf=self.ok(self.send('/workflows',{'title':'Usage summary','description':'Summary','steps':[{'title':'Produce','description':'Write a result','agent_id':aid,'depends_on':[],'required_files':['result.md']}]}))['id']
  pid=self.ok(self.send('/workflows/'+wf+'/instantiate',{'version':0,'goal':'Summarize all attempts','request_id':str(__import__('uuid').uuid4())}))['plan_id']
  self.assertEqual(self.ok(self.get('/plans/'+pid+'/usage'))['providers'],[])
  tid=self.ok(self.send('/plans/'+pid+'/approve',{'version':0,'billing_acknowledged':True}))['tasks'][0];self.wait(tid,'review')
  r=self.ok(self.get('/plans/'+pid+'/usage'))['providers'][0];self.assertEqual(r['runs'],1);self.assertEqual(r['reported_runs'],0);self.assertNotIn('input_tokens',r)
  self.assertEqual(self.get('/plans/'+str(__import__('uuid').uuid4())+'/usage')[0],404)
