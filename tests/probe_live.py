"""Explicitly authorized live subscription acceptance; never part of unittest discovery."""
import os,time,uuid,json,urllib.request
from test_api import client,call,BASE
assert os.environ.get('OFFICE_TEST_TARGET')=='live_owner','Explicit live-owner opt-in required'
c=client();assert call(c,'/auth/login',{'email':os.environ['OWNER_EMAIL'],'password':os.environ['OWNER_PASSWORD']})[0]==200
info=call(c,'/connections')[1]
for provider in ('codex','claude'):
 assert any(w['online'] and w['mode']=='subscription_cli' and w['providers'][provider]['authenticated'] for w in info['workers'])
 assert any(s['provider']==provider and s['enabled'] and s['billing_acknowledged'] for s in info['settings'])
_,w=call(c,'/workspaces',{'name':'Acceptance '+str(uuid.uuid4())[:8]});wid=w['id'];report=[]
def wait(path):
 until=time.monotonic()+180
 while time.monotonic()<until:
  d=call(c,path)[1]
  if d['task']['status'] not in ('queued','running'):return d
  time.sleep(1)
 call(c,path+'/cancel',{})
 raise RuntimeError('Live test timeout; cancellation requested')
for provider in ('codex','claude'):
 marker='OFFICE_LIVE_'+uuid.uuid4().hex[:10]
 _,t=call(c,f'/workspaces/{wid}/tasks',{'title':'Live acceptance '+provider,'description':f'Create a UTF-8 file named acceptance.txt containing exactly {marker}. Do not use the network or install anything. Reply briefly.','provider':provider})
 path=f'/workspaces/{wid}/tasks/{t["id"]}'
 assert call(c,path+'/run',{'billing_acknowledged':True})[0]==200
 d=wait(path);entry={'provider':provider,'status':d['task']['status'],'error':d['task']['error'],'task_id':t['id']};report.append(entry)
 if entry['status']!='review':continue
 a=next((a for a in d['artifacts'] if a['name']=='acceptance.txt'),None)
 assert a,'Missing deliverable'
 with c.open(BASE+'/api'+path+'/artifacts/'+a['id']) as r:assert r.read().decode().strip()==marker
 assert call(c,path+'/review',{'accept':False,'feedback':f'Edit acceptance.txt to contain exactly {marker}_REVISED. Reply briefly.'})[0]==200
 assert call(c,path+'/run',{'billing_acknowledged':True})[0]==200
 d=wait(path);entry['revision_status']=d['task']['status']
 if d['task']['status']=='review':
  a=next(a for a in d['artifacts'] if a['name']=='acceptance.txt' and a['run_id']==d['runs'][0]['id'])
  with c.open(BASE+'/api'+path+'/artifacts/'+a['id']) as r:assert r.read().decode().strip()==marker+'_REVISED'
  assert call(c,path+'/review',{'accept':True,'feedback':'Live acceptance verified'})[0]==200
  entry['accepted']=True
print(json.dumps({'workspace_id':wid,'results':report}))
