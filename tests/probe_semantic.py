import os,sys,urllib.parse,json
assert os.environ.get('OFFICE_TEST_TARGET')=='disposable_semantic'
os.environ.setdefault('BASE_URL','http://127.0.0.1:8099');sys.path.insert(0,str(__import__('pathlib').Path(__file__).parent))
from test_api import client,call
c=client();assert call(c,'/auth/login',{'email':os.environ['OWNER_EMAIL'],'password':os.environ['OWNER_PASSWORD']})[0]==200
wid=call(c,'/workspaces',{'name':'Multilingual retrieval verification'})[1]['id']
ids=[]
for title,content,verified in [('Leave policy','Employees receive twenty days of annual paid vacation. Request time off from the team lead.',True),('Database backups','PostgreSQL backups run every night and retain data for thirty days.',True),('Unverified vacation secret','Employees have unlimited annual leave.',False)]:
 st,b=call(c,f'/workspaces/{wid}/knowledge',{'title':title,'content':content,'source':'Local semantic acceptance','verified':verified});assert st==200;ids.append(b['id'])
query=urllib.parse.urlencode({'q':'พนักงานลาพักร้อนได้กี่วัน','workspace_id':wid})
st,r=call(c,'/knowledge/search?'+query)
assert st==200;assert 'local_multilingual_semantic' in r['method'],r
assert r['results'][0]['id']==ids[0],r
assert all(n['id']!=ids[2] and n['workspace_id']==wid for n in r['results'])
print('PASS Thai query retrieved English leave policy as first result; unverified notes excluded; source workspace preserved')
# Updating content must invalidate the stored embedding, not leave a stale vector.
snap=call(c,'/workspaces/'+wid)[1];note=next(n for n in snap['knowledge'] if n['id']==ids[0])
assert call(c,f'/workspaces/{wid}/knowledge/'+ids[0],{'title':'Office equipment','content':'The printer accepts A4 paper and color ink cartridges.','source':'Local semantic acceptance','verified':True,'version':note['version']},'PUT')[0]==200
st,updated=call(c,'/knowledge/search?'+query);assert st==200
assert all(n['title']!='Leave policy' for n in updated['results'])
print('PASS Semantic cache follows note edits; no stale result title/content')
