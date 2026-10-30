"""Opt-in live subscription probe; not discovered by the fixture suite."""
import os,time,uuid,json
from test_api import client,call,BASE
assert os.environ.get('OFFICE_TEST_TARGET')=='live_owner','Explicit live-owner opt-in required'
c=client()
def ok(response):
 assert response[0]==200,response
 return response[1]
ok(call(c,'/auth/login',{'email':os.environ['OWNER_EMAIL'],'password':os.environ['OWNER_PASSWORD']}))
info=ok(call(c,'/connections'))
for provider in ('codex','claude'):
 assert any(w['online'] and w['mode']=='subscription_cli' and w['providers'][provider]['authenticated'] for w in info['workers']),provider+' needs login'
 assert any(s['provider']==provider and s['enabled'] and s['billing_acknowledged'] for s in info['settings']),provider+' disabled'
wid=ok(call(c,'/workspaces',{'name':'Acceptance Skills '+uuid.uuid4().hex[:8]}))['id'];base='/workspaces/'+wid
marker='SKILL_LIVE_'+uuid.uuid4().hex[:12]
sid=ok(call(c,base+'/skills',{'title':'Live deterministic deliverable','description':'Subscription acceptance only','instructions':f'For every task using this skill, create a UTF-8 text file marker.txt containing exactly {marker}. Do not use the network, install software, or run shell commands. On a handoff task, read the accepted input marker.txt if available and reproduce it unchanged. Reply briefly.','input_contract':'Task brief and any accepted input','output_contract':'marker.txt','acceptance_criteria':'Exact skill marker'}))['id']
steps=[]
for index,provider in enumerate(('codex','claude')):
 aid=ok(call(c,base+'/agents',{'name':'Skill acceptance '+provider,'role':'Delivery specialist','instructions':'Use assigned skills and produce the required files.','provider':provider,'enabled':True}))['id']
 ok(call(c,base+'/agents/'+aid+'/organization',{'version':0,'manager_id':None,'department':'Acceptance only','responsibilities':'Follow the frozen skill and produce the file','decision_scope':'No shell, network, external writes, or purchases','skills':[{'skill_id':sid,'pinned_version':0}]},'PUT'))
 steps.append({'title':'Create deliverable' if index==0 else 'Review accepted handoff','description':'Follow the assigned Skill and produce its required deliverable. Read accepted inputs when supplied.','agent_id':aid,'depends_on':[] if index==0 else [0],'skill_ids':[sid],'required_files':['marker.txt'],'output_contract':'marker.txt with the exact value defined by the assigned Skill','acceptance_criteria':'The output matches the assigned skill exactly'})
workflow=ok(call(c,base+'/workflows',{'title':'Live skill handoff','description':'Codex to Claude through a review gate','steps':steps}))['id']
pid=ok(call(c,base+'/workflows/'+workflow+'/instantiate',{'version':0,'goal':'Verify assigned Skill execution and accepted file handoff','request_id':str(uuid.uuid4())}))['plan_id']
assert ok(call(c,base))['tasks']==[]
tasks=ok(call(c,base+'/plans/'+pid+'/approve',{'version':0,'billing_acknowledged':True}))['tasks'];report=[]
for index,tid in enumerate(tasks):
 path=base+'/tasks/'+tid;until=time.monotonic()+240
 while time.monotonic()<until:
  d=ok(call(c,path));status=d['task']['status']
  if status not in ('queued','running'):break
  time.sleep(1)
 else:
  call(c,path+'/cancel',{});raise AssertionError('Live probe timed out; cancellation requested')
 assert status=='review',{'status':status,'error':d['task']['error']}
 assert d['task']['execution_context']['skills'][0]['version']==0
 artifact=next(f for f in d['artifacts'] if f['name']=='marker.txt' and f['run_id']==d['runs'][0]['id'])
 with c.open(BASE+'/api'+path+'/artifacts/'+artifact['id']) as response:assert response.read().decode().strip()==marker
 if index==0:assert ok(call(c,base+'/tasks/'+tasks[1]))['task']['attempts']==0
 else:assert any(f['name'].startswith('inputs/') and f['name'].endswith('/marker.txt') for f in d['artifacts'])
 ok(call(c,path+'/review',{'accept':True,'feedback':'Explicit automated acceptance probe: downloaded file matches Skill marker'}))
 report.append({'provider':d['task']['provider'],'status':'done','skill_version':1,'attempts':d['task']['attempts'],'file_verified':True})
# Keep evidence recoverable without adding sample data to the active office list.
ok(call(c,base,method='DELETE'))
print(json.dumps({'workspace':wid,'archived':True,'model_calls':2,'checks':report},ensure_ascii=False))
