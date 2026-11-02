-- Names are reserved even in Trash: their on-disk output must never be reassigned.
CREATE UNIQUE INDEX workspace_unique_name ON workspaces(lower(normalize(btrim(name))));
CREATE FUNCTION office_directory_key(value text) RETURNS text LANGUAGE sql IMMUTABLE AS $fn$
 SELECT btrim(regexp_replace(lower(normalize(btrim(value))), $re$[\\/:*?"<>|[:space:][:cntrl:]]+$re$, '-', 'g'), '.- ')
$fn$;
ALTER TABLE workspaces ADD COLUMN directory_key text;
WITH names AS (SELECT id,deleted_at,created_at,coalesce(nullif(office_directory_key(name),''),'workspace-'||id::text) AS key FROM workspaces), ranked AS (SELECT *,row_number() OVER(PARTITION BY key ORDER BY (deleted_at IS NOT NULL),created_at,id) AS n FROM names)
UPDATE workspaces w SET directory_key=r.key||CASE WHEN n=1 THEN '' ELSE '-'||w.id::text END FROM ranked r WHERE r.id=w.id;
ALTER TABLE workspaces ALTER COLUMN directory_key SET NOT NULL;
CREATE UNIQUE INDEX workspace_unique_directory ON workspaces(directory_key);
CREATE TABLE workspace_directories(workspace_id uuid PRIMARY KEY REFERENCES workspaces(id),status text NOT NULL DEFAULT 'pending',error text NOT NULL DEFAULT '',updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE workspace_code_exports(run_id uuid PRIMARY KEY REFERENCES task_runs(id),workspace_id uuid NOT NULL REFERENCES workspaces(id),task_id uuid NOT NULL REFERENCES tasks(id),relative_path text NOT NULL,status text NOT NULL,error text NOT NULL DEFAULT '',files integer NOT NULL DEFAULT 0,manifest jsonb NOT NULL DEFAULT '[]',updated_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE workspace_directories ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_code_exports ENABLE ROW LEVEL SECURITY;
