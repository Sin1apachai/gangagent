"""Real CLI login URL/cancellation probe. Never approves provider sign-in or calls a model."""
import os,time
from urllib.parse import urlparse
from test_api import client,call
assert os.environ.get('OFFICE_TEST_TARGET')=='isolated_preview','Disposable preview opt-in required'
c=client()
assert call(c,'/auth/login',{'email':'audit@office.local','password':'audit-disposable-only-password-20261029'})[0]==200
info=call(c,'/connections')[1]
assert any(w['mode']=='subscription_cli' and w['online'] for w in info['workers'])
assert all(not p['authenticated'] for w in info['workers'] for p in w['providers'].values()),'Refusing to touch authenticated sessions'
for login in info['logins']:
 if login['status'] in ('queued','starting','waiting'):
  assert call(c,'/connections/login/'+login['id']+'/cancel',{})[0]==200
for provider in ('codex','claude'):
 status,r=call(c,'/connections/'+provider+'/login',{});assert status==200,(provider,status,r)
 lid=r['id']
 try:
  until=time.monotonic()+45
  while time.monotonic()<until:
   entry=next(l for l in call(c,'/connections')[1]['logins'] if l['id']==lid)
   if entry['status']=='waiting' and entry['login_url']:break
   assert entry['status'] not in ('failed','expired'),(provider,entry['status'])
   time.sleep(.4)
  else:raise RuntimeError(provider+' login did not expose its official link')
  url=urlparse(entry['login_url'])
  if provider=='codex':
   assert url.hostname in ('auth.openai.com','chatgpt.com');assert entry['device_code']
  else:assert (url.hostname,url.path) in (('claude.ai','/oauth/authorize'),('claude.com','/cai/oauth/authorize'))
  print('PASS:',provider,'official CLI login link is available; no account approval or model call was performed')
 finally:assert call(c,'/connections/login/'+lid+'/cancel',{})[0]==200
 entry=next(l for l in call(c,'/connections')[1]['logins'] if l['id']==lid)
 assert entry['status']=='cancelled';assert not entry['login_url'];assert not entry['device_code']
print('PASS: cancellation clears login details for both providers')
