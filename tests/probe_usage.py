"""Opt-in live pilot: four subscription calls, equal contracts; never claims statistical significance."""
import os,time,uuid,json
from test_api import call,client,BASE
assert os.environ.get('OFFICE_TEST_TARGET')=='live_owner'
c=client()
def ok(r):
 assert r[0]==200,r
 return r[1]
ok(call(c,'/auth/login',{'email':os.environ['OWNER_EMAIL'],'password':os.environ['OWNER_PASSWORD']}))
info=ok(call(c,'/connections'))
for provider in ('codex','claude'):
 assert any(w['online'] and w['mode']=='subscription_cli' and w['providers'][provider]['authenticated'] for w in info['workers']),provider+' login required'
 assert any(s['provider']==provider and s['enabled'] and s['billing_acknowledged'] for s in info['settings']),provider+' disabled'
wid=ok(call(c,'/workspaces',{'name':'Usage pilot '+uuid.uuid4().hex[:6]}))['id'];base='/workspaces/'+wid
rows=[]
try:
 for provider in ('codex','claude'):
  aid=ok(call(c,base+'/agents',{'name':'Usage pilot '+provider,'role':'Contract verifier','instructions':'Use the assigned specification exactly. Do not use shell or network.','provider':provider,'enabled':True,'x':4,'y':5,'birth_date':'2000-03-21'}))['id']
  ids=[]
  for n in range(4):
   sid=ok(call(c,base+'/skills',{'title':'Contract '+str(n),'description':'Benchmark contract','instructions':'Keep all field values exact. Preserve significant spaces inside strings.','input_contract':'The task brief','output_contract':'answer.json','acceptance_criteria':'Exact JSON equality, no extra fields'}))['id'];ids.append({'skill_id':sid,'pinned_version':0})
  ok(call(c,base+'/agents/'+aid+'/organization',{'version':0,'manager_id':None,'department':'Benchmark','responsibilities':'Produce the exact file','decision_scope':'No external writes','skills':ids},'PUT'))
  for mode in (('pretty','compact') if provider=='codex' else ('compact','pretty')):
   tid=ok(call(c,base+'/tasks',{'title':'Exact JSON benchmark','description':'Create answer.json containing exactly {"sum":42,"label":"keep  two spaces","items":[2,3,5]}. Do not run shell commands or use the network. Reply with a single short sentence.','acceptance_criteria':'Downloaded answer.json parses to exactly the specified object.','provider':provider,'agent_id':aid,'context_format':mode}))['id'];path=base+'/tasks/'+tid
   ok(call(c,path+'/run',{'billing_acknowledged':True}));until=time.monotonic()+240
   while time.monotonic()<until:
    d=ok(call(c,path))
    if d['task']['status'] not in ('queued','running'):break
    time.sleep(1)
   else:
    call(c,path+'/cancel',{});raise RuntimeError('Timed out, canceled')
   passed=False
   if d['task']['status']=='review':
    f=next((f for f in d['artifacts'] if f['name']=='answer.json' and f['run_id']==d['runs'][0]['id']),None)
    if f:
     with c.open(BASE+'/api'+path+'/artifacts/'+f['id']) as r:passed=json.load(r)=={'sum':42,'label':'keep  two spaces','items':[2,3,5]}
    if passed:ok(call(c,path+'/review',{'accept':True,'feedback':'Automated exact JSON equality passed'}))
   rows.append({'provider':provider,'mode':mode,'passed':passed,'attempts':d['task']['attempts'],'task_id':tid,'usage':d['runs'][0].get('usage_metrics',{}) if d['runs'] else {}})
   print(json.dumps(rows[-1]),flush=True)
finally:
 ok(call(c,base,method='DELETE'))
 with open('/private/tmp/office-usage-pilot.json','w') as f:json.dump({'workspace':wid,'archived':True,'rows':rows},f,indent=2)
