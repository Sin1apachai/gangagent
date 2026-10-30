import unittest,copy,uuid
from test_api import call,client
import test_organization as support
class Rooms(unittest.TestCase):
 setUpClass=classmethod(support.Organization.setUpClass.__func__)
 tearDownClass=classmethod(support.Organization.tearDownClass.__func__)
 ok=support.Organization.ok
 def setUp(self):
  self.wid=self.ok(call(self.admin,'/workspaces',{'name':'Room test '+uuid.uuid4().hex}))['id'];self.path='/workspaces/'+self.wid
 def snap(self):return self.ok(call(self.admin,self.path))
 def save(self,rooms,items=None,version=None,c=None):return call(c or self.admin,self.path+'/layout',{'version':self.snap()['layout_version'] if version is None else version,'layout':{'items':items or [],'rooms':rooms}},'PUT')
 def room(self,**kw):return {'id':'engineering','name':'Engineering room','department':'Engineering','purpose':'Build and review','x':0,'y':0,'width':6,'height':5,'door_side':'south','door_offset':2,**kw}
 def test_multiple_rooms_create_edit_remove_and_optimistic_conflict(self):
  rooms=[self.room(),self.room(id='design',name='Design room',department='Design',x=8,width=5)]
  self.ok(self.save(rooms));self.assertEqual(self.snap()['layout']['rooms'],rooms)
  rooms[0]['name']='Engineering HQ';self.ok(self.save(rooms));self.assertEqual(self.save(rooms,version=0)[0],409)
  self.ok(self.save(rooms[1:]));self.assertEqual(len(self.snap()['layout']['rooms']),1)
  self.ok(self.save([]));self.assertEqual(self.snap()['layout']['rooms'],[])
 def test_room_and_door_validation_is_atomic(self):
  r=self.room();self.ok(self.save([r]));before=self.snap()
  variants=[[r,r],[r,self.room(id='two',department='Design',x=5)],[self.room(x=-1)],[self.room(width=2)],[self.room(width=2147483647)],[self.room(door_side='north')],[self.room(door_offset=6)],[self.room(name='')],[r,self.room(id='duplicate-dep',department=' engineering ',x=8,width=5)]]
  for rooms in variants:self.assertEqual(self.save(rooms)[0],400,rooms)
  for x,y,kind in [(2,4,'chair'),(2,5,'chair'),(5,2,'desk')]:self.assertEqual(self.save([r],[{'id':'blocked','kind':kind,'x':x,'y':y,'rotation':0}])[0],400)
  self.assertEqual(self.snap()['layout'],before['layout']);self.assertEqual(self.snap()['layout_version'],before['layout_version'])
  self.ok(self.save([r],[{'id':'desk','kind':'desk','x':1,'y':2,'rotation':90}]))
 def test_workspace_isolation_and_read_only_member(self):
  c=client();email=uuid.uuid4().hex+'@office.local';pw='test-password-12345'
  self.ok(call(self.admin,'/admin/users',{'name':'Viewer','email':email,'password':pw}));self.ok(call(c,'/auth/login',{'email':email,'password':pw}))
  self.assertEqual(self.save([self.room()],c=c)[0],403)
  self.ok(call(self.admin,self.path+'/members',{'email':email,'role':'viewer'}));self.assertEqual(self.save([self.room()],c=c)[0],403)
  self.ok(self.save([self.room()]));self.assertEqual(self.ok(call(c,self.path))['layout']['rooms'][0]['name'],'Engineering room')
 def test_legacy_layout_and_room_delete_preserve_furniture(self):
  i={'id':'desk','kind':'desk','x':1,'y':2,'rotation':0}
  self.ok(self.save([self.room()],[i]));self.ok(self.save([],[i]));self.assertEqual(self.snap()['layout']['items'],[i])
  self.ok(call(self.admin,self.path+'/layout',{'version':self.snap()['layout_version'],'layout':{'items':[i]}},'PUT'));self.assertEqual(self.snap()['layout']['rooms'],[])
