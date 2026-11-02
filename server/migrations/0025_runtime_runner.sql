ALTER TABLE tasks ADD COLUMN runtime_enabled boolean NOT NULL DEFAULT false;
CREATE SEQUENCE runtime_port_sequence;
CREATE TABLE runtime_jobs (
 id uuid PRIMARY KEY,workspace_id uuid NOT NULL REFERENCES workspaces(id),
 task_id uuid NOT NULL REFERENCES tasks(id),source_run_id uuid NOT NULL REFERENCES task_runs(id),
 created_by uuid NOT NULL REFERENCES users(id),
 status text NOT NULL DEFAULT 'queued' CHECK(status IN('queued','building','testing','starting','ready','stopping','stopped','failed')),
 port integer NOT NULL CHECK(port BETWEEN 19000 AND 19099),
 stop_requested boolean NOT NULL DEFAULT false,
 log text NOT NULL DEFAULT '',error text NOT NULL DEFAULT '',evidence jsonb NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '2 hours'
);
CREATE UNIQUE INDEX runtime_active_source ON runtime_jobs(task_id,source_run_id) WHERE status IN('queued','building','testing','starting','ready','stopping');
CREATE UNIQUE INDEX runtime_active_port ON runtime_jobs(port) WHERE status IN('queued','building','testing','starting','ready','stopping');
CREATE TABLE runtime_runner (id boolean PRIMARY KEY DEFAULT true CHECK(id),heartbeat_at timestamptz NOT NULL DEFAULT now(),message text NOT NULL DEFAULT '');
ALTER TABLE runtime_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE runtime_runner ENABLE ROW LEVEL SECURITY;
CREATE TABLE system_standards (id text NOT NULL,version integer NOT NULL,title text NOT NULL,instructions text NOT NULL,checksum text NOT NULL,PRIMARY KEY(id,version));
ALTER TABLE system_standards ENABLE ROW LEVEL SECURITY;
