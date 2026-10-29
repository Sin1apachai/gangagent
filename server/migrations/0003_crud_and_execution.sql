ALTER TABLE users ADD COLUMN deleted_at timestamptz;
ALTER TABLE workspaces ADD COLUMN deleted_at timestamptz, ADD COLUMN version integer NOT NULL DEFAULT 0;
ALTER TABLE tasks DROP CONSTRAINT tasks_status_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_status_check CHECK(status IN ('queued','running','review','done','failed','cancelled','waiting_auth','waiting_quota','interrupted'));
ALTER TABLE tasks ADD COLUMN deleted_at timestamptz, ADD COLUMN version integer NOT NULL DEFAULT 0,
 ADD COLUMN execution_requested boolean NOT NULL DEFAULT false, ADD COLUMN cancel_requested boolean NOT NULL DEFAULT false,
 ADD COLUMN attempts integer NOT NULL DEFAULT 0, ADD COLUMN current_run_id uuid,
 ADD COLUMN lease_until timestamptz, ADD COLUMN result text NOT NULL DEFAULT '', ADD COLUMN error text NOT NULL DEFAULT '',
 ADD COLUMN review_feedback text NOT NULL DEFAULT '';
ALTER TABLE knowledge ADD COLUMN deleted_at timestamptz, ADD COLUMN version integer NOT NULL DEFAULT 0;
CREATE TABLE agents (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id), name text NOT NULL,
 role text NOT NULL, instructions text NOT NULL, provider text NOT NULL CHECK(provider IN ('codex','claude')),
 x integer NOT NULL CHECK(x BETWEEN 0 AND 19), y integer NOT NULL CHECK(y BETWEEN 0 AND 11),
 enabled boolean NOT NULL DEFAULT true, version integer NOT NULL DEFAULT 0, deleted_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE tasks ADD COLUMN agent_id uuid REFERENCES agents(id);
CREATE TABLE provider_connections (
 user_id uuid REFERENCES users(id), provider text CHECK(provider IN ('codex','claude')),
 enabled boolean NOT NULL DEFAULT false, billing_acknowledged boolean NOT NULL DEFAULT false,
 PRIMARY KEY(user_id,provider)
);
CREATE TABLE workers (
 id text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), mode text NOT NULL,
 providers jsonb NOT NULL DEFAULT '{}', heartbeat_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE task_runs (
 id uuid PRIMARY KEY, task_id uuid NOT NULL REFERENCES tasks(id), worker_id text NOT NULL,
 status text NOT NULL, started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
 result text NOT NULL DEFAULT '', error text NOT NULL DEFAULT '', prompt text NOT NULL
);
CREATE TABLE task_events (
 id bigserial PRIMARY KEY, task_id uuid NOT NULL REFERENCES tasks(id), run_id uuid,
 message text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE artifacts (
 id uuid PRIMARY KEY, task_id uuid NOT NULL REFERENCES tasks(id), run_id uuid NOT NULL REFERENCES task_runs(id),
 name text NOT NULL, size bigint NOT NULL
);
CREATE INDEX queue_claim_idx ON tasks(created_by,created_at) WHERE deleted_at IS NULL AND status='queued' AND execution_requested;
