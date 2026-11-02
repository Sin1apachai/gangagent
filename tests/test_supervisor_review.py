"""Supervisor orchestration through isolated fixture workers only."""
import time,uuid,unittest
from test_api import call,client
import test_organization as support
class AgentReview(unittest.TestCase):
 setUpClass=classmethod(support.Organization.setUpClass.__func__)
 tearDownClass=classmethod(support.Organization.tearDownClass.__func__)
 ok=support.Organization.ok
 def setUp(self):
  self.base='/workspaces/'+self.ok(call(self.admin,'/workspaces',{'name':'Supervisor '+uuid.uuid4().hex}))['id']
 def get(self,path=''):return self.ok(call(self.admin,self.base+path))
 def send(self,path,data=None,method=None):return self.ok(call(self.admin,self.base+path,data,method))
 def agent(self,name):return self.send('/agents',{'name':name,'role':'Engineer','instructions':'Check actual evidence','provider':'codex','enabled':True})['id']
 def setup_plan(self,marker='',mode='manager',manager=True):
  lead=self.agent('Lead');dev=self.agent('Developer')
  if manager:self.send('/agents/'+dev+'/organization',{'version':0,'manager_id':lead,'skills':[]},'PUT')
  steps=[{'title':'Build '+marker,'description':'[test:knowledge-doc] '+marker,'agent_id':dev,'depends_on':[],'required_files':['requirements.md'],'review_mode':mode,'review_agent_id':lead if mode=='agent' else None,'acceptance_criteria':'Review actual deliverable'}, {'title':'Final owner delivery','description':'Summarize accepted work','agent_id':lead,'depends_on':[0],'review_mode':'manager'}]
  wf=self.send('/workflows',{'title':'Supervised workflow','steps':steps})['id'];pid=self.send('/workflows/'+wf+'/instantiate',{'version':0,'goal':'Fixture supervisor acceptance','request_id':str(uuid.uuid4())})['plan_id'];ids=self.send('/plans/'+pid+'/approve',{'version':0,'billing_acknowledged':True})['tasks'];return ids,pid
 def wait(self,tid,predicate,timeout=55):
  until=time.monotonic()+timeout
  while time.monotonic()<until:
   d=self.get('/tasks/'+tid)
   if predicate(d['task']):return d
   time.sleep(.15)
  self.fail('Unexpected task state: '+str(d['task']['status'])+' '+str(d['task'].get('review_note')))
 def reviews(self,tid):return [t for t in self.get()['tasks'] if t.get('review_for_task_id')==tid]
 def test_manager_pass_saves_knowledge_and_only_final_waits_for_owner(self):
  ids,pid=self.setup_plan();first=self.wait(ids[0],lambda t:t['status']=='done');self.assertEqual(first['task']['review_state'],'passed');final=self.wait(ids[1],lambda t:t['status']=='review');self.assertEqual(final['task']['review_mode'],'owner');reviews=self.reviews(ids[0]);self.assertEqual(len(reviews),1);self.assertEqual(reviews[0]['status'],'done');notes=self.get()['knowledge'];self.assertEqual(len(notes),1);self.assertIn('APPROVED_VERSION_ONE',notes[0]['content']);self.assertEqual(call(self.admin,self.base+'/tasks/'+reviews[0]['id']+'/knowledge',{})[0],400)
  self.send('/tasks/'+ids[1]+'/review',{'accept':True,'feedback':'Final accepted'});self.assertEqual(len(self.get()['knowledge']),2)
  evidence=self.get('/plans/'+pid+'/delivery-evidence');self.assertEqual(evidence['assessment'],'documents_only');self.assertFalse(evidence['runtime_verified']);self.assertEqual(evidence['code_files'],0)
 def test_revision_returns_to_producer_and_second_review_passes(self):
  ids,_=self.setup_plan('[test:review-revise]');d=self.wait(ids[0],lambda t:t['status']=='done');self.assertEqual(d['task']['attempts'],2);self.assertEqual(len(self.reviews(ids[0])),2);self.assertEqual(len(self.get()['knowledge']),1)
 def test_revision_budget_escalates_after_three_attempts(self):
  ids,_=self.setup_plan('[test:review-always-revise]');d=self.wait(ids[0],lambda t:t['review_state']=='needs_owner');self.assertEqual(d['task']['status'],'review');self.assertEqual(d['task']['attempts'],3);self.assertEqual(len(self.reviews(ids[0])),3);self.assertEqual(self.get()['knowledge'],[]);self.assertEqual(self.get('/tasks/'+ids[1])['task']['attempts'],0);time.sleep(2.2);self.assertEqual(len(self.reviews(ids[0])),3)
 def test_invalid_and_escalated_reviews_never_accept_or_create_knowledge(self):
  for marker in ['[test:review-invalid]','[test:review-escalate]']:
   with self.subTest(marker=marker):
    ids,_=self.setup_plan(marker,mode='agent');d=self.wait(ids[0],lambda t:t['review_state']=='needs_owner');self.assertEqual(d['task']['status'],'review');self.assertEqual(self.get('/tasks/'+ids[1])['task']['attempts'],0);self.assertEqual(self.get()['knowledge'],[])
 def test_missing_manager_falls_back_without_model_review_task(self):
  ids,_=self.setup_plan(manager=False);d=self.wait(ids[0],lambda t:t['review_state']=='needs_owner');self.assertIsNone(d['task']['review_agent_id']);self.assertEqual(self.reviews(ids[0]),[])
 def test_self_and_foreign_reviewer_cannot_be_configured(self):
  dev=self.agent('Dev');other_base='/workspaces/'+self.ok(call(self.admin,'/workspaces',{'name':'Foreign'}))['id'];foreign=self.ok(call(self.admin,other_base+'/agents',{'name':'Foreign reviewer','role':'Lead','instructions':'None','provider':'codex','enabled':True}))['id']
  for aid in [dev,foreign]:
   step={'title':'Work','description':'Test','agent_id':dev,'depends_on':[],'review_mode':'agent','review_agent_id':aid}
   self.assertEqual(call(self.admin,self.base+'/workflows',{'title':'Invalid reviewer','steps':[step]})[0],400)
 def test_owner_revision_while_review_running_makes_late_review_stale(self):
  ids,_=self.setup_plan('[test:review-slow]');self.wait(ids[0],lambda t:t['review_state']=='waiting_agent')
  until=time.monotonic()+20
  while time.monotonic()<until:
   rows=self.reviews(ids[0])
   if rows and rows[0]['status']=='running':break
   time.sleep(.1)
  else:self.fail('Review never ran')
  review=rows[0];self.assertEqual(call(self.admin,self.base+'/tasks/'+review['id']+'/review',{'accept':True,'feedback':'Cannot manually accept a review job'})[0],409)
  self.send('/tasks/'+ids[0]+'/review',{'accept':False,'feedback':'Owner requested a different scope'});time.sleep(3);d=self.get('/tasks/'+ids[0])['task'];self.assertEqual(d['status'],'queued');self.assertFalse(d['execution_requested']);self.assertEqual(self.get()['knowledge'],[])
 def test_evidence_endpoint_is_workspace_scoped(self):
  ids,pid=self.setup_plan(manager=False);route=self.base+'/plans/'+pid+'/delivery-evidence';self.assertEqual(call(client(),route)[0],401);other=self.ok(call(self.admin,'/workspaces',{'name':'Other'}))['id'];self.assertEqual(call(self.admin,'/workspaces/'+other+'/plans/'+pid+'/delivery-evidence')[0],404)

 def test_review_quota_waits_for_reset_and_resumes_without_accepting_early(self):
  ids,_=self.setup_plan('[test:review-quota]');self.wait(ids[0],lambda t:t['review_state']=='waiting_agent')
  until=time.monotonic()+25
  while time.monotonic()<until:
   rows=self.reviews(ids[0])
   if rows and rows[0]['status']=='waiting_quota':break
   time.sleep(.1)
  else:self.fail('Reviewer did not wait for quota')
  self.assertEqual(self.get('/tasks/'+ids[0])['task']['status'],'review');self.assertEqual(self.get()['knowledge'],[])
  self.wait(ids[0],lambda t:t['status']=='done',timeout=40);self.assertEqual(len(self.reviews(ids[0])),1);self.assertEqual(self.reviews(ids[0])[0]['attempts'],2)

 def test_disabled_reviewer_cannot_apply_a_late_decision(self):
  ids,_=self.setup_plan('[test:review-slow]');self.wait(ids[0],lambda t:t['review_state']=='waiting_agent')
  until=time.monotonic()+20
  while time.monotonic()<until:
   rows=self.reviews(ids[0])
   if rows and rows[0]['status']=='running':break
   time.sleep(.1)
  else:self.fail('Review never ran')
  self.send('/agents/'+rows[0]['agent_id'],method='DELETE');self.wait(ids[0],lambda t:t['review_state']=='needs_owner');self.assertEqual(self.get('/tasks/'+ids[0])['task']['status'],'review');self.assertEqual(self.get()['knowledge'],[])
