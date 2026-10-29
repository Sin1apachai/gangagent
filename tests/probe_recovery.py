"""Manual Docker Compose probe. Disposable preview only, never part of normal test discovery."""
import json,os,sys,time
from test_api import client,call
assert os.environ.get('OFFICE_TEST_TARGET')=='isolated_preview','Explicit isolated-preview opt-in required'
c=client();assert call(c,'/auth/login',{'email':'preview@office.local','password':'local-preview-only-2026'})[0]==200
mode=sys.argv[1]
if mode=='start':
 info=call(c,'/connections')[1];assert any(w['online'] and w['mode']=='fixture' for w in info['workers'])
 _,w=call(c,'/workspaces',{'name':'Disposable recovery probe'});wid=w['id']
 call(c,'/connections/codex',{'enabled':True,'billing_acknowledged':True},'PUT')
 _,t=call(c,f'/workspaces/{wid}/tasks',{'title':'Worker recovery probe','description':'[test:slow]','provider':'codex'})
 tid=t['id'];path=f'/workspaces/{wid}/tasks/{tid}'
 assert call(c,path+'/run',{'billing_acknowledged':True})[0]==200
 for _ in range(100):
  if call(c,path)[1]['task']['status']=='running':break
  time.sleep(.1)
 else:raise RuntimeError('Fixture task never started')
 print(json.dumps({'wid':wid,'tid':tid}))
else:
 ids=json.loads(sys.argv[2]);path=f'/workspaces/{ids["wid"]}/tasks/{ids["tid"]}'
 for _ in range(180):
  d=call(c,path)[1]
  if d['task']['status']=='interrupted':break
  time.sleep(.2)
 else:raise RuntimeError('Expired lease not recovered: '+str(d))
 assert not d['task']['execution_requested'];assert d['task']['attempts']==1;assert len(d['runs'])==1
 print('PASS: Worker restart leaves an interrupted task, one attempt, no duplicate execution, and requires explicit retry.')
