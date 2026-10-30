import json,os,tempfile,unittest,uuid
from pathlib import Path
from project_bridge import Bridge,safe
class LocalFolders(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name);self.bridge=Bridge(self.root/'private');self.project=self.root/'my project';self.project.mkdir();self.owner=str(uuid.uuid4());self.f=self.bridge.register(self.project,self.owner);self.binding={**self.f,'owner':self.owner}
 def tearDown(self):self.tmp.cleanup()
 def test_scan_hides_secrets_symlinks_and_binaries(self):
  (self.project/'hello.txt').write_text('hello');(self.project/'.env').write_text('secret');(self.project/'private.key').write_text('secret');(self.project/'binary').write_bytes(b'\0\1');(self.project/'link').symlink_to(self.root/'private',target_is_directory=True)
  s=self.bridge.handle('/snapshot',self.binding);self.assertEqual(s['files'],[{'path':'hello.txt','content':'hello'}])
 def test_preserves_mode_and_rejects_conflicts_before_any_write(self):
  p=self.project/'app.sh';p.write_text('before');p.chmod(0o755);s=self.bridge.handle('/snapshot',self.binding);p.write_text('human')
  with self.assertRaises(ValueError):self.bridge.handle('/publish',{**self.binding,'snapshot_id':s['snapshot_id'],'files':[{'path':'new.txt','content':'new'},{'path':'app.sh','content':'agent'}]})
  self.assertFalse((self.project/'new.txt').exists());self.assertEqual(p.read_text(),'human');p.write_text('before')
  self.bridge.handle('/publish',{**self.binding,'snapshot_id':s['snapshot_id'],'files':[{'path':'app.sh','content':'agent'}]});self.assertEqual(p.read_text(),'agent');self.assertEqual(p.stat().st_mode&0o777,0o755)
 def test_escape_new_symlink_other_user_and_replaced_folder_denied(self):
  s=self.bridge.handle('/snapshot',self.binding)
  for path in ['../x','/etc/passwd','.env','a/../../x','key.pem','node_modules/x','a\\b']:
   with self.assertRaises(ValueError):self.bridge.handle('/publish',{**self.binding,'snapshot_id':s['snapshot_id'],'files':[{'path':path,'content':'bad'}]})
  (self.project/'linked').symlink_to(self.root/'private',target_is_directory=True)
  with self.assertRaises(OSError):self.bridge.handle('/publish',{**self.binding,'snapshot_id':s['snapshot_id'],'files':[{'path':'linked/x','content':'bad'}]})
  with self.assertRaises(ValueError):self.bridge.handle('/snapshot',{**self.binding,'owner':str(uuid.uuid4())})
  self.project.rename(self.root/'moved');self.project.mkdir()
  with self.assertRaises(ValueError):self.bridge.handle('/snapshot',self.binding)
 def test_registry_survives_restart_and_snapshot_cannot_be_replayed(self):
  s=self.bridge.handle('/snapshot',self.binding);bridge=Bridge(self.root/'private');bridge.handle('/publish',{**self.binding,'snapshot_id':s['snapshot_id'],'files':[{'path':'new.txt','content':'new'}]})
  with self.assertRaises(ValueError):bridge.handle('/publish',{**self.binding,'snapshot_id':s['snapshot_id'],'files':[]})
  self.assertEqual((self.project/'new.txt').read_text(),'new')
 def test_limits_refuse_oversized_tree(self):
  for n in range(201):(self.project/(str(n)+'.txt')).write_text('x')
  with self.assertRaises(ValueError):self.bridge.handle('/snapshot',self.binding)
if __name__=='__main__':unittest.main()
