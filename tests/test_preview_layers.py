import time,uuid,unittest
from test_api import call,client,BASE
import test_organization as support
class PreviewLayers(unittest.TestCase):
 setUpClass=classmethod(support.Organization.setUpClass.__func__)
 tearDownClass=classmethod(support.Organization.tearDownClass.__func__)
 ok=support.Organization.ok
 def setUp(self):self.wid=self.ok(call(self.admin,'/workspaces',{'name':'Preview/layers '+uuid.uuid4().hex}))['id'];self.base='/workspaces/'+self.wid
 def test_text_preview_preserves_download_and_workspace_authorization(self):
  tid=self.ok(call(self.admin,self.base+'/tasks',{'title':'Preview file','description':'Return a fixture document','provider':'codex'}))['id'];path=self.base+'/tasks/'+tid
  self.ok(call(self.admin,path+'/run',{'billing_acknowledged':True}))
  for _ in range(150):
   d=self.ok(call(self.admin,path))
   if d['task']['status']=='review':break
   time.sleep(.1)
  else:self.fail('No artifact produced')
  artifact=d['artifacts'][0];url=path+'/artifacts/'+artifact['id'];preview=self.ok(call(self.admin,url+'?preview=true'));self.assertEqual(preview['kind'],'text');self.assertIn('FIXTURE TEST ONLY',preview['content'])
  with self.admin.open(BASE+'/api'+url) as r:self.assertIn('attachment',r.headers['Content-Disposition']);self.assertEqual(r.read().decode(),preview['content'])
  self.assertEqual(call(client(),url+'?preview=true')[0],401)
  email=uuid.uuid4().hex+'@office.local';pw='preview-test-password-123';self.ok(call(self.admin,'/admin/users',{'name':'Isolated preview','email':email,'password':pw}));other=client();self.ok(call(other,'/auth/login',{'email':email,'password':pw}));self.assertEqual(call(other,url+'?preview=true')[0],403)
  wid=self.ok(call(self.admin,'/workspaces',{'name':'Other preview scope'}))['id'];self.assertEqual(call(self.admin,'/workspaces/'+wid+'/tasks/'+tid+'/artifacts/'+artifact['id']+'?preview=true')[0],404)
 def test_layers_roundtrip_and_same_level_overlap_rejected(self):
  def item(id,kind,x=3,y=3):return {'id':id,'kind':kind,'x':x,'y':y,'rotation':0}
  items=[item('pc','computer'),item('desk','desk'),item('rug','rug')];self.ok(call(self.admin,self.base+'/layout',{'version':0,'layout':{'items':items,'rooms':[]}},'PUT'));self.assertEqual(self.ok(call(self.admin,self.base))['layout']['items'],items)
  for extra in [item('desk2','desk'),item('pc2','computer'),item('rug2','rug')]:self.assertEqual(call(self.admin,self.base+'/layout',{'version':1,'layout':{'items':items+[extra],'rooms':[]}},'PUT')[0],400)
  self.assertEqual(call(self.admin,self.base+'/layout',{'version':1,'layout':{'items':[item('plant','plant'),item('pc','computer')],'rooms':[]}},'PUT')[0],400)
  self.assertEqual(self.ok(call(self.admin,self.base))['layout_version'],1)
 def test_media_preview_and_html_are_non_executable(self):
  import base64,json
  tid=self.ok(call(self.admin,self.base+'/tasks',{'title':'Media preview','description':'Fixture only','provider':'codex'}))['id'];path=self.base+'/tasks/'+tid
  png=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jXwAAAABJRU5ErkJggg==')
  for name,payload in [('pixel.png',png),('page.html',b'<script>alert("not executed")</script>'),('binary.bin',b'\x00\xff')]:self.ok(call(self.admin,path+'/attachments',{'name':name,'data':list(payload)}))
  self.ok(call(self.admin,path+'/run',{'billing_acknowledged':True}))
  for _ in range(150):
   d=self.ok(call(self.admin,path))
   if d['task']['status']=='review':break
   time.sleep(.1)
  else:self.fail('No media artifacts')
  for suffix in ['pixel.png','page.html','binary.bin']:self.assertTrue(any(f['name'].endswith(suffix) for f in d['artifacts']))
  for f in d['artifacts']:
   url=BASE+'/api'+path+'/artifacts/'+f['id']+'?preview=true'
   if f['name'].endswith('pixel.png'):
    with self.admin.open(url) as r:self.assertEqual(r.headers['Content-Type'],'image/png');self.assertEqual(r.headers['X-Content-Type-Options'],'nosniff');self.assertEqual(r.read(),png)
   if f['name'].endswith('page.html'):
    with self.admin.open(url) as r:self.assertTrue(r.headers['Content-Type'].startswith('application/json'));self.assertIn('<script>',json.load(r)['content'])
   if f['name'].endswith('binary.bin'):self.assertEqual(call(self.admin,path+'/artifacts/'+f['id']+'?preview=true')[0],400)
