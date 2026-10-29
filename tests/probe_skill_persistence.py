import subprocess,uuid,os
assert os.environ.get("OFFICE_TEST_TARGET")=="isolated_preview", "Explicit isolated-preview opt-in required"
project=os.environ["OFFICE_TEST_PROJECT"];assert project!="agent-office" and "preview" in project
container=project+"-postgres-1";target='organization_restore_'+uuid.uuid4().hex[:10]
def run(args,**kw):return subprocess.run(args,check=True,capture_output=True,**kw)
def sql(database,text):return run(['docker','exec',container,'psql','-U','office','-d',database,'-At','-v','ON_ERROR_STOP=1','-c',text]).stdout
before=sql('office_test',"SELECT (SELECT count(*) FROM skill_versions)||':'||(SELECT count(*) FROM agent_skills)||':'||(SELECT count(*) FROM workflow_versions)||':'||(SELECT count(*) FROM tasks WHERE execution_context IS NOT NULL)")
dump=run(['docker','exec',container,'pg_dump','-U','office','-d','office_test','-Fc']).stdout
run(['docker','exec',container,'createdb','-U','office',target])
try:
 run(['docker','exec','-i',container,'pg_restore','-U','office','-d',target,'--no-owner','--no-privileges'],input=dump)
 after=sql(target,"SELECT (SELECT count(*) FROM skill_versions)||':'||(SELECT count(*) FROM agent_skills)||':'||(SELECT count(*) FROM workflow_versions)||':'||(SELECT count(*) FROM tasks WHERE execution_context IS NOT NULL)")
 assert before==after,(before,after)
 for table in ('skill_versions','workflow_versions'):
  result=subprocess.run(['docker','exec',container,'psql','-U','office','-d',target,'-v','ON_ERROR_STOP=1','-c',f"UPDATE {table} SET title='Illegal overwrite'"],capture_output=True)
  assert result.returncode!=0 and b'Published revisions are immutable' in result.stderr
 print('PASS backup/restore: skill revisions, bindings, workflow revisions and frozen task context match; immutable triggers reject overwrites')
finally:run(['docker','exec',container,'dropdb','-U','office',target])
