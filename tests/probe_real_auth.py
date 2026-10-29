"""Checks real CLIs fail closed before model execution when no subscription is logged in."""
import os,time
from test_api import client,call
assert os.environ.get('OFFICE_TEST_TARGET')=='isolated_preview','Explicit isolated-preview opt-in required'
c=client();assert call(c,'/auth/login',{'email':'preview@office.local','password':'local-preview-only-2026'})[0]==200
for _ in range(90):
 workers=[w for w in call(c,'/connections')[1]['workers'] if w['online'] and w['mode']=='subscription_cli']
 if workers:break
 time.sleep(.5)
else:raise RuntimeError('Real CLI worker unavailable')
assert all(not p['authenticated'] for w in workers for p in w['providers'].values()),'Refusing probe: a provider is already authenticated'
_,w=call(c,'/workspaces',{'name':'Disposable real CLI auth probe'});wid=w['id']
for provider in ('codex','claude'):
 try:
  assert call(c,'/connections/'+provider,{'enabled':True,'billing_acknowledged':True},'PUT')[0]==200
  _,t=call(c,f'/workspaces/{wid}/tasks',{'title':'Unauthenticated CLI probe','description':'This must never reach a model without login.','provider':provider})
  path=f'/workspaces/{wid}/tasks/{t["id"]}';assert call(c,path+'/run',{'billing_acknowledged':True})[0]==200
  for _ in range(150):
   d=call(c,path)[1]
   if d['task']['status']=='waiting_auth':break
   time.sleep(.3)
  else:raise RuntimeError('Auth guard failed: '+str(d))
  assert d['task']['attempts']==0;assert not d['artifacts'];assert not d['task']['result'];assert not d['task']['execution_requested']
  print('PASS:',provider,'real CLI is unauthenticated; task waits for login with zero model attempts.')
 finally:call(c,'/connections/'+provider,{'enabled':False,'billing_acknowledged':False},'PUT')
