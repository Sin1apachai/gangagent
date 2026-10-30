import unittest,time,uuid,io,tarfile,hashlib,json,urllib.request
from test_api import call,client,BASE
import test_organization as support
class Backups(unittest.TestCase):
 setUpClass=classmethod(support.Organization.setUpClass.__func__)
 tearDownClass=classmethod(support.Organization.tearDownClass.__func__)
 setUp=support.Organization.setUp
 get=support.Organization.get;send=support.Organization.send;ok=support.Organization.ok
 task=support.Organization.task;detail=support.Organization.detail;start=support.Organization.start;wait=support.Organization.wait
 def state(self):return self.ok(call(self.admin,'/admin/backups'))
 def service(self):
  for _ in range(100):
   if self.state()['online']:return
   time.sleep(.2)
  self.fail('Backup service unavailable')
 def job(self,id,states,timeout=40):
  until=time.monotonic()+timeout
  while time.monotonic()<until:
   rows=self.state()['jobs'];row=next((r for r in rows if r['id']==id),None)
   if row and row['status'] in states:return row
   if row and row['status']=='failed':self.fail(str(row))
   time.sleep(.15)
  self.fail('Backup did not reach '+str(states))
 def remove(self,id):
  self.ok(call(self.admin,'/admin/backups/'+id,{},'DELETE'))
  for _ in range(100):
   if id not in {r['id'] for r in self.state()['jobs']}:return
   time.sleep(.1)
  self.fail('Backup file was not deleted')
 def test_backup_permissions_and_confirmation(self):
  self.assertEqual(call(client(),'/admin/backups')[0],401)
  email='backup-'+uuid.uuid4().hex+'@office.local';pw='local-test-password-12345'
  self.ok(call(self.admin,'/admin/users',{'name':'Backup unprivileged','email':email,'password':pw}));other=client();self.ok(call(other,'/auth/login',{'email':email,'password':pw}))
  fake=str(uuid.uuid4())
  for path,data,method in [('/admin/backups',None,None),('/admin/backups',{'acknowledged':True},None),('/admin/backups/'+fake+'/download',None,None),('/admin/backups/'+fake+'/cancel',{},None),('/admin/backups/'+fake,{},'DELETE'),('/admin/backups/recover',{},None)]:
   self.assertEqual(call(other,path,data,method)[0],403,path)
  self.assertEqual(call(self.admin,'/admin/backups',{'acknowledged':False})[0],400)
  self.assertEqual(call(self.admin,'/admin/backups/'+fake+'/download')[0],404)
 def test_cancel_waiting_preserves_active_ai_and_unpauses(self):
  self.service();tid=self.task(None,'[test:slow] Backup must not cancel this work');self.ok(self.start(tid));self.wait(tid,'running')
  bid=self.ok(call(self.admin,'/admin/backups',{'acknowledged':True}))['id'];self.job(bid,{'waiting'})
  self.assertEqual(call(self.admin,'/admin/backups',{'acknowledged':True})[0],409)
  self.assertEqual(call(self.admin,'/admin/backups/'+bid+'/download')[0],404)
  self.ok(call(self.admin,'/admin/backups/'+bid+'/cancel',{}));self.job(bid,{'cancelled'})
  for _ in range(50):
   if not self.state()['paused']:break
   time.sleep(.1)
  self.assertFalse(self.state()['paused']);self.assertNotEqual(self.detail(tid)['task']['status'],'cancelled');self.wait(tid,'review',20);self.remove(bid)
 def test_download_complete_bundle_checksum_and_delete(self):
  self.service();tid=self.task(None,'Backup an actual registered fixture artifact');self.ok(self.start(tid));self.wait(tid,'review')
  bid=self.ok(call(self.admin,'/admin/backups',{'acknowledged':True}))['id'];j=self.job(bid,{'ready'});self.assertGreater(j['bytes'],0);self.assertFalse(self.state()['paused'])
  with self.admin.open(BASE+'/api/admin/backups/'+bid+'/download') as r:
   raw=r.read();self.assertEqual(r.headers['Cache-Control'],'no-store');self.assertEqual(r.headers['X-Backup-Sha256'],hashlib.sha256(raw).hexdigest());self.assertIn('attachment;',r.headers['Content-Disposition'])
  self.assertEqual(j['bytes'],len(raw));self.assertEqual(j['sha256'],hashlib.sha256(raw).hexdigest())
  with tarfile.open(fileobj=io.BytesIO(raw)) as t:
   self.assertEqual(set(t.getnames()),{'office.dump','artifacts.tar.gz','manifest.json','SHA256SUMS','post-restore.sql'});self.assertTrue(all(m.isfile() for m in t))
   contents={m.name:t.extractfile(m).read() for m in t}
  for line in contents['SHA256SUMS'].decode().splitlines():
   checksum,name=line.split('  ',1);self.assertEqual(hashlib.sha256(contents[name]).hexdigest(),checksum)
  manifest=json.loads(contents['manifest.json']);self.assertEqual(manifest['format'],'agent-office-backup');self.assertGreater(manifest['registered_artifact_count'],0);self.assertIn('sessions',manifest['excluded'])
  with tarfile.open(fileobj=io.BytesIO(contents['artifacts.tar.gz'])) as t:
   self.assertTrue(all((m.isfile() or m.isdir()) and m.name.startswith('runs/') and '..' not in m.name.split('/') for m in t))
   self.assertTrue(any(m.isfile() and m.name.endswith('/result.md') for m in t))
  self.assertEqual(call(self.admin,'/admin/backups/recover',{})[0],409)
  self.remove(bid);self.assertEqual(call(self.admin,'/admin/backups/'+bid+'/download')[0],404)
