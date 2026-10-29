import os,json,time,uuid,unittest,urllib.request,urllib.error,http.cookiejar
BASE=os.environ['BASE_URL']
def client():return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
def call(c,path,data=None,method=None,header=True):
 body=json.dumps(data).encode() if data is not None else None
 h={'Content-Type':'application/json'}
 if header:h['X-Office-Client']='1'
 req=urllib.request.Request(BASE+'/api'+path,data=body,method=method or ('POST' if body is not None else 'GET'),headers=h)
 try:
  with c.open(req,timeout=10) as r:return r.status,json.load(r)
 except urllib.error.HTTPError as e:
  try:return e.code,json.load(e)
  except:return e.code,{}
class Office(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.admin=client()
  for _ in range(90):
   try:
    if call(cls.admin,'/health')[0]==200:break
   except Exception:pass
   time.sleep(1)
  else:raise RuntimeError('App did not become ready')
  assert call(cls.admin,'/auth/login',{'email':os.environ['OWNER_EMAIL'],'password':os.environ['OWNER_PASSWORD']})[0]==200
  assert call(cls.admin,'/workspaces')[1] == [], 'Fresh installation must have no seeded workspaces'
  cls.other=client();email=f'test-{uuid.uuid4()}@office.local';pw='local-test-password-12345'
  assert call(cls.admin,'/admin/users',{'email':email,'name':'Integration test','password':pw})[0]==200
  assert call(cls.other,'/auth/login',{'email':email,'password':pw})[0]==200
  cls.wid=call(cls.admin,'/workspaces',{'name':'Integration '+str(uuid.uuid4())})[1]['id']
  cls.other_wid=call(cls.other,'/workspaces',{'name':'Private integration office'})[1]['id']
 def test_new_workspace_is_empty(self):
  wid=call(self.other,'/workspaces',{'name':'Empty office'})[1]['id']
  snap=call(self.other,'/workspaces/'+wid)[1]
  self.assertEqual(snap['layout'],{'items':[]})
  self.assertEqual(snap['tasks'],[])
  self.assertEqual(snap['knowledge'],[])
 def test_auth_and_csrf(self):
  self.assertEqual(call(client(),'/auth/me')[0],401)
  self.assertEqual(call(client(),'/auth/login',{'email':'x','password':'x'},header=False)[0],403)
  self.assertTrue(call(self.admin,'/auth/me')[1]['is_super_admin'])
 def test_workspace_isolation(self):
  self.assertEqual(call(self.other,'/workspaces/'+self.wid)[0],403)
  self.assertEqual(call(self.other,f'/workspaces/{self.wid}/tasks',{'title':'blocked','description':'','provider':'codex'})[0],403)
  self.assertEqual(call(self.other,f'/workspaces/{self.wid}/knowledge',{'title':'blocked','content':'x','source':''})[0],403)
  self.assertEqual(call(self.other,f'/workspaces/{self.wid}/layout',{'version':0,'layout':{'items':[]}},'PUT')[0],403)
  self.assertEqual(call(self.admin,'/workspaces/'+self.other_wid)[0],200)
  self.assertNotIn(self.wid,[w['id'] for w in call(self.other,'/workspaces')[1]])
  self.assertEqual(call(self.other,'/admin/users',{'email':'x@y','name':'x','password':'123456789012'})[0],403)
 def test_task_persistence_and_cancel(self):
  status,t=call(self.admin,f'/workspaces/{self.wid}/tasks',{'title':'Build first screen','description':'Acceptance criteria','provider':'codex'})
  self.assertEqual(status,200)
  snap=call(self.admin,'/workspaces/'+self.wid)[1]
  self.assertTrue(any(x['id']==t['id'] and x['status']=='queued' for x in snap['tasks']))
  self.assertEqual(call(self.admin,f'/workspaces/{self.wid}/tasks/{t["id"]}/cancel',{})[0],200)
  self.assertEqual(call(self.admin,f'/workspaces/{self.wid}/tasks/{t["id"]}/cancel',{})[0],409)
  self.assertEqual(call(self.admin,f'/workspaces/{self.wid}/tasks',{'title':'Invalid','description':'','provider':'paid-api'})[0],400)
 def test_knowledge(self):
  _,k=call(self.admin,f'/workspaces/{self.wid}/knowledge',{'title':'Team rules','content':'Use subscription only','source':'Owner'})
  snap=call(self.admin,'/workspaces/'+self.wid)[1]
  row=next(x for x in snap['knowledge'] if x['id']==k['id'])
  self.assertEqual(row['content'],'Use subscription only');self.assertFalse(row['verified'])
 def test_layout_conflict_and_validation(self):
  path=f'/workspaces/{self.wid}/layout';v=call(self.admin,'/workspaces/'+self.wid)[1]['layout_version']
  item={'id':'one','kind':'desk','x':4,'y':3,'rotation':0};b={'version':v,'layout':{'items':[item]}}
  self.assertEqual(call(self.admin,path,b,'PUT')[0],200)
  self.assertEqual(call(self.admin,path,b,'PUT')[0],409)
  b['version']=v+1;b['layout']['items'].append({**item,'id':'two'})
  self.assertEqual(call(self.admin,path,b,'PUT')[0],400)
  b['layout']['items']=[{**item,'x':20}];self.assertEqual(call(self.admin,path,b,'PUT')[0],400)
 def test_logout(self):
  c=client();call(c,'/auth/login',{'email':os.environ['OWNER_EMAIL'],'password':os.environ['OWNER_PASSWORD']})
  self.assertEqual(call(c,'/auth/logout',{})[0],200);self.assertEqual(call(c,'/auth/me')[0],401)
 def test_health_and_static(self):
  self.assertEqual(call(self.admin,'/health')[1]['ai_execution'],'worker_requires_provider_login')
  with urllib.request.urlopen(BASE) as r:self.assertIn(b'Agent Office',r.read())
