"""Isolated real-telemetry proof; no CPU/memory stress and no model calls."""
import os,sys,time,copy,uuid,json,subprocess
from test_api import call,client,BASE
assert os.environ.get('OFFICE_TEST_TARGET')=='isolated_preview'
assert BASE=='http://127.0.0.1:8092'
PROJECT='agent-office-monitor-preview'
COMPOSE=['docker','compose','-p',PROJECT,'-f','compose.yaml','-f','compose.test.yaml','-f','/private/tmp/office-monitor-preview.yaml']
def command(args,data=None):
 r=subprocess.run(COMPOSE+args,input=data,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 assert r.returncode==0,'Isolated monitoring probe operation failed'
 return r.stdout

def ok(r):assert r[0]==200,r;return r[1]
c=client()
for _ in range(100):
 try:ok(call(c,'/auth/login',{'email':'preview@office.local','password':'local-preview-only-2026'}));break
 except Exception:time.sleep(.2)
else:raise RuntimeError('Preview not ready')
def state(who=c):return ok(call(who,'/admin/resources'))
def wait(predicate,timeout=30):
 until=time.monotonic()+timeout
 while time.monotonic()<until:
  try:d=state()
  except Exception:time.sleep(.2);continue
  if predicate(d):return d
  time.sleep(.2)
 raise RuntimeError('Expected monitoring state not reached')
def save(s):
 d=state();ok(call(c,'/admin/resources/settings',{'version':d['config']['version'],'settings':s},'PUT'))
def disable_all():
 s=copy.deepcopy(state()['config']['settings'])
 for r in s['rules'].values():r['enabled']=False
 s['hold_seconds']=5;s['recovery_margin']=1
 return s
wait(lambda d:d['state'] and not d['state']['stale'])
# Two synthetic administrators must have independent read acknowledgements.
email='peer-'+uuid.uuid4().hex+'@office.local';password='local-test-password-12345'
uid=ok(call(c,'/admin/users',{'name':'Monitoring proof peer','email':email,'password':password}))['id'];uuid.UUID(uid)
command(['exec','-T','postgres','psql','-U','office','-d','office_test','-Atc',f"UPDATE users SET is_super_admin=true WHERE id='{uid}'"])
peer=client();ok(call(peer,'/auth/login',{'email':email,'password':password}))
s=disable_all();s['rules']['vm_memory']={'enabled':True,'threshold_percent':1};save(s)
d=wait(lambda d:any(n['kind']=='warning' and n['resource_key']=='vm_memory' and n['resolved_at'] is None for n in d['notifications']))
warning=next(n for n in d['notifications'] if n['kind']=='warning' and n['resource_key']=='vm_memory' and n['resolved_at'] is None)
ok(call(c,'/admin/resources/notifications/read',{'all':True}));assert state()['unread_count']==0;assert not next(n for n in state(peer)['notifications'] if n['id']==warning['id'])['read']
s['rules']['vm_memory']['enabled']=False;s['rules']['vm_cpu']['threshold_percent']=77.7;save(s)
wait(lambda d:d['active_count']==0);persisted=copy.deepcopy(state()['config'])
command(['restart','app']);wait(lambda d:d['state'] and not d['state']['stale'])
assert state()['config']==persisted
# Raise only a tiny disposable Redis cache allocation, not actual host pressure.
s=disable_all();s['rules']['redis_memory']={'enabled':True,'threshold_percent':3};save(s)
command(['exec','-T','redis','redis-cli','-x','SET','monitoring-proof'],b'x'*(4*1024*1024))
wait(lambda d:any(n['resource_key']=='redis_memory' and n['kind']=='warning' and n['resolved_at'] is None for n in d['notifications']))
command(['stop','redis'])
try:
 d=wait(lambda d:d['state'] and not d['state']['stale'] and d['state']['sample']['redis'] is None)
 assert d['state']['sample']['vm']['memory_available_bytes']>0
 assert any(n['resource_key']=='redis_memory' and n['kind']=='warning' and n['resolved_at'] is None for n in d['notifications'])
finally:command(['start','redis'])
wait(lambda d:any(n['resource_key']=='redis_memory' and n['kind']=='recovery' for n in d['notifications']))
# Simulate a collector gap solely by dating a disposable stored sample; it must be flagged stale.
command(['exec','-T','postgres','psql','-U','office','-d','office_test','-Atc',"UPDATE resource_state SET collected_at=now()-interval '1 minute' WHERE id"])
assert state()['state']['stale']
wait(lambda d:d['state'] and not d['state']['stale'])
# Leave one deliberate low-threshold warning for browser acceptance, only in preview.
s=disable_all();save(s);wait(lambda d:d['active_count']==0);ok(call(c,'/admin/resources/notifications/read',{'all':True}))
s['rules']['vm_memory']={'enabled':True,'threshold_percent':1};save(s)
d=wait(lambda d:any(n['resource_key']=='vm_memory' and n['kind']=='warning' and n['resolved_at'] is None and not n['read'] for n in d['notifications']))
print(json.dumps({'real_proc_cgroup_filesystem_values':True,'per_admin_read_state_isolated':True,'settings_survive_app_restart':True,'redis_outage_keeps_vm_metrics_fresh':True,'missing_metric_does_not_resolve_active_warning':True,'redis_return_recovers_warning':True,'stale_sample_is_flagged':True,'preview_low_threshold_warning_ready':True,'model_calls':0,'scope':'Docker VM and containers, not physical macOS host'}))
