"""Opt-in 6-call workflow pilot. Counts all producer/reviewer/revision usage."""
import os,time,json,uuid
from test_api import call,client,BASE
assert os.environ.get('OFFICE_TEST_TARGET')=='live_owner'
c=client()
def ok(r):
 assert r[0]==200,r
 return r[1]
ok(call(c,'/auth/login',{'email':os.environ['OWNER_EMAIL'],'password':os.environ['OWNER_PASSWORD']}))
info=ok(call(c,'/connections'))
for provider in ('codex','claude'):
 assert any(w['online'] and w['mode']=='subscription_cli' and w['providers'][provider]['authenticated'] for w in info['workers']),provider+' needs login'
 assert any(s['provider']==provider and s['enabled'] and s['billing_acknowledged'] for s in info['settings']),provider+' disabled'
wid=ok(call(c,'/workspaces',{'name':'Focused workflow pilot '+uuid.uuid4().hex[:6]}))['id'];base='/workspaces/'+wid
rows=[];expected={'region':'ap-southeast-1','retry_limit':7,'max_parallel':3,'guard_header':'x-aster-guard','public_publish':False,'label':'keep  two spaces','audit_tag':'ASTER_CHECK_'+uuid.uuid4().hex[:8]}
def note(title,content):return ok(call(c,base+'/knowledge',{'title':title,'content':content,'source':'Deterministic acceptance fixture','verified':True}))['id']
def wait(tid):
 path=base+'/tasks/'+tid;until=time.monotonic()+240
 while time.monotonic()<until:
  d=ok(call(c,path))
  if d['task']['status'] not in ('queued','running'):
   assert d['task']['status']=='review',{'status':d['task']['status'],'error':d['task']['error']};return d
  time.sleep(1)
 call(c,path+'/cancel',{});raise RuntimeError('Timeout; canceled')
def download(d,name):
 f=next(f for f in d['artifacts'] if f['run_id']==d['runs'][0]['id'] and f['name']==name)
 with c.open(BASE+'/api'+base+'/tasks/'+d['task']['id']+'/artifacts/'+f['id']) as r:return json.load(r)
def save(mode,stage,d,passed):
 rows.append({'mode':mode,'stage':stage,'provider':d['task']['provider'],'passed':passed,'task_id':d['task']['id'],'run_id':d['runs'][0]['id'],'usage':d['runs'][0]['usage_metrics']});print(json.dumps(rows[-1]),flush=True)
 assert passed,'Exact artifact verification failed'
try:
 # 18 plausible archived office documents unrelated to the release specification.
 topics=['Cafeteria seating','Visitor umbrellas','Bicycle lockers','Gardening calendar','Library shelves','Stationery inventory','Kitchen utensils','Window cleaning','Parking zones','Recycling bins','Coffee varieties','Lunch reservations','Hallway lighting','Reception flowers','Pantry shopping','Fitness towels','Holiday decorations','Lost property']
 paragraph=('The facilities archive records routine supplies, furniture locations, seasonal preferences, visitor arrangements, and historical quantities. Staff can consult the reception desk about umbrellas, bicycle lockers, flower vases, kitchen utensils, linen cupboards, paper recycling, and cafeteria seating. Monthly entries describe cupboard labels, shelf heights, coffee varieties, lunch reservations, watering schedules, and holiday decorations. Historical records retain dates and vendor descriptions for housekeeping reference. ')
 for i,title in enumerate(topics):note(title+' archive '+str(i),(paragraph*5)+f'Archive item {i}.')
 note('Aster release specification',json.dumps({k:v for k,v in expected.items() if k not in ('public_publish','audit_tag')})+' These are mandatory Aster release values. Preserve the significant two spaces in label.')
 note('Aster exception register',json.dumps({'public_publish':False,'audit_tag':expected['audit_tag'],'revision_required':2})+' Mandatory Aster exception values. No public publishing is permitted.')
 agents=[]
 for provider in ('codex','claude'):
  agents.append(ok(call(c,base+'/agents',{'name':'Aster '+provider,'role':'Release engineer' if provider=='codex' else 'Evidence reviewer','instructions':'Preserve exact source facts and significant spaces. Use no shell, network, paid services or external writes. Never invent missing source facts.','provider':provider,'enabled':True}))['id'])
 producer='For Aster, read verified release specification AND exception register. Create config.json with exactly keys region,retry_limit,max_parallel,guard_header,public_publish,label,audit_tag using source values. Also create handoff.json with summary, decisions (array of concise source facts), open_questions (array), artifacts=["config.json"]. No extra config keys. Brief final summary.'
 reviewer='For Aster, inspect accepted upstream config.json and handoff.json, check ALL values against verified specification AND exception register. Create audit.json with exactly {"config":<the accepted config object>,"revision":1,"passed":true}. On revision feedback, preserve config and passed, use revision_required from the exception register for revision and add checked=true. Do not modify accepted input files. Brief final summary.'
 steps=[{'title':'Aster release configuration','description':producer,'agent_id':agents[0],'depends_on':[],'required_files':['config.json','handoff.json'],'acceptance_criteria':'Exact source values, significant spaces, valid handoff references'},{'title':'Aster evidence audit','description':reviewer,'agent_id':agents[1],'depends_on':[0],'required_files':['audit.json'],'acceptance_criteria':'Exact accepted config values and requested audit fields'}]
 wf=ok(call(c,base+'/workflows',{'title':'Aster handoff and revision','description':'Live token/quality comparison','steps':steps}))['id']
 for mode in ('compact','focused'):
  pid=ok(call(c,base+'/workflows/'+wf+'/instantiate',{'version':0,'goal':'Aster release handoff and evidence audit','request_id':str(uuid.uuid4())}))['plan_id']
  tids=ok(call(c,base+'/plans/'+pid+'/approve',{'version':0,'billing_acknowledged':True,'context_format':mode}))['tasks']
  d=wait(tids[0]);passed=download(d,'config.json')==expected
  brief=download(d,'handoff.json');passed=passed and brief.get('artifacts')==['config.json'] and bool(brief.get('summary'))
  save(mode,'producer',d,passed);ok(call(c,base+'/tasks/'+tids[0]+'/review',{'accept':True,'feedback':'Downloaded config matches every source value; handoff references verified'}))
  d=wait(tids[1]);save(mode,'reviewer',d,download(d,'audit.json')=={'config':expected,'revision':1,'passed':True})
  ok(call(c,base+'/tasks/'+tids[1]+'/review',{'accept':False,'feedback':'Use revision_required from the verified Aster exception register as revision. Preserve config and passed, and add checked=true.'}))
  ok(call(c,base+'/tasks/'+tids[1]+'/run',{'billing_acknowledged':True}))
  d=wait(tids[1]);save(mode,'revision',d,download(d,'audit.json')=={'config':expected,'revision':2,'passed':True,'checked':True})
  ok(call(c,base+'/tasks/'+tids[1]+'/review',{'accept':True,'feedback':'Exact revised audit equality passed'}))
finally:
 # Cancellation/archival retains evidence and prevents pending jobs from continuing.
 for t in ok(call(c,base))['tasks']:
  if t['status'] in ('running','queued'):call(c,base+'/tasks/'+t['id']+'/cancel',{})
 call(c,base,method='DELETE')
 with open('/private/tmp/office-focused-pilot.json','w') as f:json.dump({'workspace':wid,'archived':True,'knowledge_documents':20,'rows':rows},f,indent=2)
