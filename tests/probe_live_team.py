"""Small opt-in live subscription collaboration acceptance, three model requests maximum."""
import os,time,uuid,json
from test_api import client,call,BASE
assert os.environ.get('OFFICE_TEST_TARGET')=='live_owner'
c=client();assert call(c,'/auth/login',{'email':os.environ['OWNER_EMAIL'],'password':os.environ['OWNER_PASSWORD']})[0]==200
wid=call(c,'/workspaces',{'name':'Team acceptance '+uuid.uuid4().hex[:8]})[1]['id']
agents=[]
for provider,role in [('codex','Producer and planner'),('claude','Reviewer')]:
 s,a=call(c,f'/workspaces/{wid}/agents',{'name':'Acceptance '+provider,'role':role,'instructions':'Follow the exact file acceptance criteria; do not use network or install tools.','provider':provider,'x':len(agents)*3+2,'y':3,'enabled':True});assert s==200;agents.append(a['id'])
marker='OFFICE_TEAM_'+uuid.uuid4().hex[:12]
goal=f'Create EXACTLY TWO sequential steps and no others. Step 0 assigned to agent {agents[0]}: produce UTF-8 source.txt containing exactly {marker}. Step 1 assigned to agent {agents[1]}, depends_on [0]: read the accepted source.txt from inputs/<parent-task>/source.txt, verify its marker, and create verified.txt with exactly the same content. This second step is the review/final summary step. No shell commands, no installs, no network.'
s,p=call(c,f'/workspaces/{wid}/plans',{'goal':goal,'manager_agent_id':agents[0],'steps':[]});assert s==200
path=f'/workspaces/{wid}/tasks/'+p['planner_task_id']
def wait(path):
 end=time.monotonic()+180
 while time.monotonic()<end:
  d=call(c,path)[1]
  if d['task']['status'] not in ('queued','running'):return d
  time.sleep(1)
 call(c,path+'/cancel',{});raise RuntimeError('Live team timeout; cancelled')
assert call(c,path+'/run',{'billing_acknowledged':True})[0]==200
d=wait(path);assert d['task']['status']=='review',d['task']['status']
assert call(c,path+'/review',{'accept':True,'feedback':'Planner proposal checked'})[0]==200
planpath=f'/workspaces/{wid}/plans/'+p['id'];assert call(c,planpath+'/import',{})[0]==200
plan=next(x for x in call(c,f'/workspaces/{wid}/plans')[1] if x['id']==p['id'])
assert len(plan['steps'])==2,'Refusing unexpected model call budget'
assert [x['agent_id'] for x in plan['steps']]==agents
assert plan['steps'][0]['depends_on']==[] and plan['steps'][1]['depends_on']==[0]
assert call(c,planpath+'/approve',{'version':plan['version'],'billing_acknowledged':True})[0]==200
alltasks=call(c,'/workspaces/'+wid)[1]['tasks'];tasks=[x for x in alltasks if x.get('plan_id')==p['id']]
producer=next(x for x in tasks if x['agent_id']==agents[0]);reviewer=next(x for x in tasks if x['agent_id']==agents[1])
parentpath=f'/workspaces/{wid}/tasks/'+producer['id'];childpath=f'/workspaces/{wid}/tasks/'+reviewer['id']
d=wait(parentpath);assert d['task']['status']=='review'
child=call(c,childpath)[1];assert child['task']['status']=='queued' and child['task']['attempts']==0
file=next(a for a in d['artifacts'] if a['name']=='source.txt')
with c.open(BASE+'/api'+parentpath+'/artifacts/'+file['id']) as r:assert r.read().decode().strip()==marker
assert call(c,parentpath+'/review',{'accept':True,'feedback':'Producer file marker verified'})[0]==200
d=wait(childpath);assert d['task']['status']=='review'
file=next(a for a in d['artifacts'] if a['name']=='verified.txt')
with c.open(BASE+'/api'+childpath+'/artifacts/'+file['id']) as r:assert r.read().decode().strip()==marker
assert call(c,childpath+'/review',{'accept':True,'feedback':'Accepted handoff file verified'})[0]==200
print(json.dumps({'workspace_id':wid,'plan_id':p['id'],'planner':'passed','codex_producer':'passed','review_gate':'passed','claude_file_handoff':'passed','accepted':True}))
