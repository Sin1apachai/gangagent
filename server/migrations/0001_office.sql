CREATE TABLE users (
 id uuid PRIMARY KEY, email text UNIQUE NOT NULL, name text NOT NULL,
 password_hash text NOT NULL, is_super_admin boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sessions (
 token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL
);
CREATE TABLE workspaces (
 id uuid PRIMARY KEY, name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 layout jsonb NOT NULL DEFAULT '{"items":[]}', layout_version integer NOT NULL DEFAULT 0
);
CREATE TABLE memberships (
 workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE,
 user_id uuid REFERENCES users(id) ON DELETE CASCADE,
 role text NOT NULL CHECK (role IN ('owner','member','viewer')),
 PRIMARY KEY(workspace_id,user_id)
);
CREATE TABLE tasks (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 title text NOT NULL, description text NOT NULL, provider text NOT NULL CHECK(provider IN ('codex','claude')),
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','review','done','failed','cancelled')),
 created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tasks_workspace_idx ON tasks(workspace_id,created_at);
CREATE TABLE knowledge (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 title text NOT NULL, content text NOT NULL, source text NOT NULL DEFAULT '',
 verified boolean NOT NULL DEFAULT false, created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE audit_events (
 id bigserial PRIMARY KEY, user_id uuid REFERENCES users(id), workspace_id uuid REFERENCES workspaces(id),
 action text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
