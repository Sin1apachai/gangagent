-- Keep all legacy export rows and standards for historical audit.
ALTER TABLE system_standards ADD COLUMN retired boolean NOT NULL DEFAULT false;
UPDATE system_standards SET retired=true WHERE id='workspace-code-export' OR (id='application-runtime' AND version=1);
ALTER TABLE projects ADD COLUMN code_directory_key text;
WITH names AS (SELECT id,workspace_id,created_at,CASE WHEN office_directory_key(name)='' THEN 'project-'||id::text WHEN office_directory_key(name)='app' THEN 'app-project' ELSE office_directory_key(name) END AS key FROM projects), ranked AS (SELECT *,row_number() OVER(PARTITION BY workspace_id,key ORDER BY created_at,id) AS n FROM names)
UPDATE projects p SET code_directory_key=r.key||CASE WHEN n=1 THEN '' ELSE '-'||p.id::text END FROM ranked r WHERE r.id=p.id;
ALTER TABLE projects ALTER COLUMN code_directory_key SET NOT NULL;
CREATE UNIQUE INDEX project_code_directory_unique ON projects(workspace_id,code_directory_key);
CREATE TABLE project_code_sessions(run_id uuid PRIMARY KEY REFERENCES task_runs(id),workspace_id uuid NOT NULL REFERENCES workspaces(id),project_id uuid REFERENCES projects(id),relative_path text NOT NULL,state text NOT NULL,base jsonb NOT NULL DEFAULT '{}',error text NOT NULL DEFAULT '',updated_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE project_code_sessions ENABLE ROW LEVEL SECURITY;
