CREATE SEQUENCE worker_linux_uid START 20000 MAXVALUE 60000 NO CYCLE;
CREATE TABLE worker_bindings (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), worker_id text NOT NULL UNIQUE,
 db_role text NOT NULL UNIQUE, redis_hash text NOT NULL, linux_uid integer NOT NULL DEFAULT nextval('worker_linux_uid'),
 label text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz
);
CREATE FUNCTION office_worker_uid() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT b.user_id FROM public.worker_bindings b JOIN public.users u ON u.id=b.user_id
 WHERE b.db_role=session_user AND b.revoked_at IS NULL AND u.deleted_at IS NULL
$$;
CREATE FUNCTION office_worker_access(wid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.memberships m JOIN public.workspaces w ON w.id=m.workspace_id
 WHERE m.workspace_id=wid AND m.user_id=public.office_worker_uid() AND m.role IN ('owner','member') AND w.deleted_at IS NULL)
$$;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY personal_worker_scope ON users USING (id=office_worker_uid()) WITH CHECK (id=office_worker_uid());
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
CREATE POLICY personal_worker_scope ON workspaces USING (office_worker_access(id)) WITH CHECK (office_worker_access(id));
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
CREATE POLICY personal_worker_scope ON memberships USING (user_id=office_worker_uid()) WITH CHECK (user_id=office_worker_uid());
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY personal_worker_scope ON tasks USING (created_by=office_worker_uid() AND office_worker_access(workspace_id)) WITH CHECK (created_by=office_worker_uid() AND office_worker_access(workspace_id));
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
CREATE POLICY personal_worker_scope ON agents USING (office_worker_access(workspace_id)) WITH CHECK (office_worker_access(workspace_id));
ALTER TABLE knowledge ENABLE ROW LEVEL SECURITY;
CREATE POLICY personal_worker_scope ON knowledge USING (verified AND deleted_at IS NULL AND office_worker_access(workspace_id)) WITH CHECK (verified AND deleted_at IS NULL AND office_worker_access(workspace_id));
ALTER TABLE provider_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY personal_worker_scope ON provider_connections USING (user_id=office_worker_uid()) WITH CHECK (user_id=office_worker_uid());
ALTER TABLE workers ENABLE ROW LEVEL SECURITY;
CREATE POLICY personal_worker_scope ON workers USING (user_id=office_worker_uid()) WITH CHECK (user_id=office_worker_uid());
ALTER TABLE provider_logins ENABLE ROW LEVEL SECURITY;
CREATE POLICY personal_worker_scope ON provider_logins USING (user_id=office_worker_uid()) WITH CHECK (user_id=office_worker_uid());
ALTER TABLE plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY personal_worker_scope ON plans USING (created_by=office_worker_uid() AND office_worker_access(workspace_id)) WITH CHECK (created_by=office_worker_uid() AND office_worker_access(workspace_id));
ALTER TABLE task_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY personal_worker_scope ON task_runs USING (EXISTS(SELECT 1 FROM tasks t WHERE t.id=task_id)) WITH CHECK (EXISTS(SELECT 1 FROM tasks t WHERE t.id=task_id));
ALTER TABLE task_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY personal_worker_scope ON task_events USING (EXISTS(SELECT 1 FROM tasks t WHERE t.id=task_id)) WITH CHECK (EXISTS(SELECT 1 FROM tasks t WHERE t.id=task_id));
ALTER TABLE artifacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY personal_worker_scope ON artifacts USING (EXISTS(SELECT 1 FROM tasks t WHERE t.id=task_id)) WITH CHECK (EXISTS(SELECT 1 FROM tasks t WHERE t.id=task_id));
ALTER TABLE task_attachments ENABLE ROW LEVEL SECURITY;
CREATE POLICY personal_worker_scope ON task_attachments USING (EXISTS(SELECT 1 FROM tasks t WHERE t.id=task_id)) WITH CHECK (EXISTS(SELECT 1 FROM tasks t WHERE t.id=task_id));
ALTER TABLE task_dependencies ENABLE ROW LEVEL SECURITY;
CREATE POLICY personal_worker_scope ON task_dependencies USING (EXISTS(SELECT 1 FROM tasks t WHERE t.id=task_id) AND EXISTS(SELECT 1 FROM tasks t WHERE t.id=depends_on)) WITH CHECK (EXISTS(SELECT 1 FROM tasks t WHERE t.id=task_id) AND EXISTS(SELECT 1 FROM tasks t WHERE t.id=depends_on));
