import unittest,uuid,time,datetime
import test_organization as support
from test_api import call,client
class Personnel(unittest.TestCase):
 setUpClass=classmethod(support.Organization.setUpClass.__func__)
 tearDownClass=classmethod(support.Organization.tearDownClass.__func__)
 setUp=support.Organization.setUp
 get=support.Organization.get;send=support.Organization.send;ok=support.Organization.ok;agent=support.Organization.agent
 task=support.Organization.task;detail=support.Organization.detail;start=support.Organization.start;wait=support.Organization.wait;review=support.Organization.review
 workflow=support.Organization.workflow;step=support.Organization.step;approve=support.Organization.approve;member=support.Organization.member
 def body(self,**extra):return {'name':'Personality candidate','role':'Engineer','instructions':'Work with evidence','provider':'codex','enabled':True,**extra}
 def test_master_data_is_seeded_without_sample_agents(self):
  self.assertEqual(call(client(),'/master-data')[0],401)
  m=self.ok(call(self.admin,'/master-data'));self.assertEqual(len(m['zodiac']),12);self.assertEqual(len(m['rule']),12);self.assertEqual(len(m['trait']),12);self.assertEqual(sum(c['weight'] for c in m['criterion']),100)
  self.assertEqual(len(m['versions']),1);self.assertEqual(m['versions'][0]['version'],1);self.assertEqual(self.get()[1]['agents'],[])
 def test_birth_dates_boundaries_and_validation(self):
  cases={'2000-02-29':'pisces','2026-03-20':'pisces','2026-03-21':'aries','2026-04-19':'aries','2026-04-20':'taurus','2026-12-21':'sagittarius','2026-12-22':'capricorn','2026-01-19':'capricorn','2026-01-20':'aquarius'}
  for birth,sign in cases.items():
   aid=self.ok(self.send('/agents',self.body(birth_date=birth)))['id'];agent=next(a for a in self.get()[1]['agents'] if a['id']==aid)
   self.assertEqual(agent['personality']['zodiac_id'],sign);self.assertEqual(agent['birth_date'],birth);self.assertEqual(len({t['id'] for t in agent['personality']['traits']}),3)
  for birth in ('1900-02-29','2026-02-30','2026-04-31','0000-01-01','2026-13-01','2026-1-1','not a date'):
   self.assertEqual(self.send('/agents',self.body(birth_date=birth))[0],400,birth)
 def test_personality_is_stable_and_can_be_cleared(self):
  body=self.body(birth_date='2000-06-05');aid=self.ok(self.send('/agents',body))['id'];old=next(a for a in self.get()[1]['agents'] if a['id']==aid)
  self.ok(self.send('/agents/'+aid,{**body,'version':old['version'],'name':'Renamed'},'PUT'));new=next(a for a in self.get()[1]['agents'] if a['id']==aid);self.assertEqual(old['personality'],new['personality'])
  legacy={k:v for k,v in body.items() if k!='birth_date'};self.ok(self.send('/agents/'+aid,{**legacy,'version':new['version']},'PUT'));new=next(a for a in self.get()[1]['agents'] if a['id']==aid);self.assertEqual(old['personality'],new['personality'])
  self.ok(self.send('/agents/'+aid,{**body,'birth_date':'','version':new['version']},'PUT'));new=next(a for a in self.get()[1]['agents'] if a['id']==aid);self.assertIsNone(new['birth_date']);self.assertIsNone(new['personality'])
 def test_task_freezes_personality_before_birth_date_changes(self):
  body=self.body(birth_date='2000-03-21');aid=self.ok(self.send('/agents',body))['id'];tid=self.task(aid,'[test:slow] personality freeze');self.ok(self.start(tid));old=self.detail(tid)['task']['execution_context']['agent']['personality'];a=next(a for a in self.get()[1]['agents'] if a['id']==aid)
  self.ok(self.send('/agents/'+aid,{**body,'birth_date':'2000-12-25','version':a['version']},'PUT'));done=self.wait(tid,'review');self.assertEqual(done['task']['execution_context']['agent']['personality'],old);self.assertIn('2000-03-21',done['task']['result']);self.assertNotIn('2000-12-25',done['task']['result'])
 def recruitment(self,reject=False):
  candidate=self.agent('Candidate');evaluator=self.agent('Evaluator');workflow=self.workflow([self.step(candidate,'Trial work'),self.step(evaluator,'Evaluate trial',[0])]);body={'candidate_id':candidate,'workflow_id':workflow,'workflow_version':0,'role_title':'Research engineer','goal':'[test:reject-candidate]' if reject else 'Assess trial evidence'}
  application=self.ok(self.send('/recruitment',body));return candidate,application
 def test_recruitment_rejection_ribbon_reason_and_new_round(self):
  candidate,app=self.recruitment(True);self.assertEqual(self.send('/recruitment/'+app['id']+'/decision',{'version':0})[0],400)
  tids=self.ok(self.approve(app['plan_id']))['tasks'];self.wait(tids[0],'review');self.ok(self.review(tids[0]));self.wait(tids[1],'review');self.assertEqual(self.send('/recruitment/'+app['id']+'/decision',{'version':0})[0],400);self.ok(self.review(tids[1]));d=self.ok(self.send('/recruitment/'+app['id']+'/decision',{'version':0}));self.assertFalse(d['passed']);self.assertTrue(d['reason'])
  a=next(a for a in self.get()[1]['agents'] if a['id']==candidate);self.assertFalse(a['selection_passed']);self.assertEqual(a['selection_reason'],d['reason']);self.assertEqual(self.get('/recruitment')[1][0]['status'],'rejected');self.assertEqual(self.send('/recruitment/'+app['id']+'/decision',{'version':0})[0],409)
 def test_recruitment_passes_only_after_every_review(self):
  candidate,app=self.recruitment();tids=self.ok(self.approve(app['plan_id']))['tasks'];self.wait(tids[0],'review');self.ok(self.review(tids[0]));self.wait(tids[1],'review');self.ok(self.review(tids[1]));self.assertEqual(self.get('/recruitment')[1][0]['status'],'awaiting_decision');self.assertTrue(self.ok(self.send('/recruitment/'+app['id']+'/decision',{'version':0}))['passed'])
 def test_recruitment_permissions_and_self_evaluation(self):
  candidate=self.agent();workflow=self.workflow([self.step(candidate)]);body={'candidate_id':candidate,'workflow_id':workflow,'workflow_version':0,'role_title':'Engineer','goal':'Trial'}
  self.assertEqual(self.send('/recruitment',body)[0],400)
  member,_=self.member();self.assertEqual(self.send('/recruitment',body,c=member)[0],403)
  viewer,_=self.member('viewer');self.assertEqual(self.get('/recruitment',viewer)[0],200);self.assertEqual(self.send('/recruitment',body,c=viewer)[0],403)
  evaluator=self.agent();workflow=self.workflow([self.step(evaluator)]);self.assertEqual(self.send('/recruitment',{**body,'candidate_id':str(uuid.uuid4()),'workflow_id':workflow})[0],400)
 def test_quota_timer_resumes_once_and_keeps_context(self):
  aid=self.agent();tid=self.task(aid,'[test:quota-once]');self.ok(self.start(tid));d=self.wait(tid,'waiting_quota');self.assertTrue(d['task']['quota_reset_at']);self.assertTrue(d['task']['next_quota_check_at']);context=d['task']['execution_context'];done=self.wait(tid,'review',35);self.assertEqual(done['task']['attempts'],2);self.assertEqual(done['task']['quota_retries'],1);self.assertEqual(len(done['runs']),2);self.assertEqual(done['task']['execution_context'],context);self.assertIsNone(done['task']['next_quota_check_at'])
 def test_quota_opt_out_and_cancel_do_not_resume(self):
  aid=self.agent();tid=self.task(aid,'[test:quota-once]');self.ok(self.start(tid));d=self.wait(tid,'waiting_quota');self.ok(self.send('/tasks/'+tid+'/quota',{'version':d['task']['version'],'auto_resume':False,'check_minutes':30,'reset_at':None},'PUT'));self.assertIsNone(self.detail(tid)['task']['next_quota_check_at']);time.sleep(3);self.assertEqual(self.detail(tid)['task']['attempts'],1)
  self.ok(self.send('/tasks/'+tid+'/cancel',{}));self.assertEqual(self.detail(tid)['task']['status'],'cancelled')
 def test_quota_policy_permissions_timestamp_and_versions(self):
  tid=self.task(self.agent());v=self.detail(tid)['task']['version'];body={'version':v,'auto_resume':True,'check_minutes':5,'reset_at':(datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(hours=1)).isoformat()}
  viewer,_=self.member('viewer');self.assertEqual(self.send('/tasks/'+tid+'/quota',body,'PUT',viewer)[0],403)
  member,_=self.member();self.assertEqual(self.send('/tasks/'+tid+'/quota',body,'PUT',member)[0],403)
  self.assertEqual(self.send('/tasks/'+tid+'/quota',{**body,'check_minutes':1},'PUT')[0],400)
  self.assertEqual(self.send('/tasks/'+tid+'/quota',{**body,'reset_at':'2027-01-01T10:00:00'},'PUT')[0],400)
  self.assertEqual(self.send('/tasks/'+tid+'/quota',{**body,'reset_at':'2000-01-01T00:00:00Z'},'PUT')[0],400)
  self.ok(self.send('/tasks/'+tid+'/quota',body,'PUT'));self.assertEqual(self.send('/tasks/'+tid+'/quota',body,'PUT')[0],409)
 def test_quota_cancel_before_reset_is_not_automatically_restarted(self):
  tid=self.task(self.agent(),'[test:quota-once]');self.ok(self.start(tid));self.wait(tid,'waiting_quota');self.ok(self.send('/tasks/'+tid+'/cancel',{}));time.sleep(12);d=self.detail(tid);self.assertEqual(d['task']['status'],'cancelled');self.assertEqual(d['task']['attempts'],1);self.assertEqual(len(d['runs']),1)
 def test_invalid_agent_selection_report_cannot_change_candidate(self):
  candidate=self.agent('Candidate');evaluator=self.agent('Evaluator');workflow=self.workflow([self.step(evaluator,'Decision')]);app=self.ok(self.send('/recruitment',{'candidate_id':candidate,'workflow_id':workflow,'workflow_version':0,'role_title':'Engineer','goal':'[test:invalid-selection]'}));tid=self.ok(self.approve(app['plan_id']))['tasks'][0];self.wait(tid,'review');self.ok(self.review(tid));self.assertEqual(self.send('/recruitment/'+app['id']+'/decision',{'version':0})[0],400);self.assertIsNone(next(a for a in self.get()[1]['agents'] if a['id']==candidate)['selection_passed']);self.assertEqual(self.get('/recruitment')[1][0]['version'],0)
 def test_new_selection_round_preserves_prior_rejection_history(self):
  candidate,app=self.recruitment(True);tids=self.ok(self.approve(app['plan_id']))['tasks']
  for tid in tids:self.wait(tid,'review');self.ok(self.review(tid))
  self.ok(self.send('/recruitment/'+app['id']+'/decision',{'version':0}))
  evaluator=self.agent('Second evaluator');workflow=self.workflow([self.step(evaluator,'Second decision')]);new=self.ok(self.send('/recruitment',{'candidate_id':candidate,'workflow_id':workflow,'workflow_version':0,'role_title':'Another position','goal':'New evidence'}));tid=self.ok(self.approve(new['plan_id']))['tasks'][0];self.wait(tid,'review');self.ok(self.review(tid));self.ok(self.send('/recruitment/'+new['id']+'/decision',{'version':0}));rows=self.get('/recruitment')[1];self.assertEqual({r['status'] for r in rows},{'passed','rejected'});self.assertTrue(next(a for a in self.get()[1]['agents'] if a['id']==candidate)['selection_passed'])
