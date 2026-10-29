CREATE TABLE provider_logins (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), worker_id text NOT NULL REFERENCES workers(id),
 provider text NOT NULL CHECK(provider IN ('codex','claude')),
 status text NOT NULL CHECK(status IN ('queued','starting','waiting','completed','failed','cancelled','expired')),
 login_url text NOT NULL DEFAULT '', device_code text NOT NULL DEFAULT '', message text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL DEFAULT now()+interval '10 minutes'
);
CREATE UNIQUE INDEX one_active_login_per_worker ON provider_logins(worker_id) WHERE status IN ('queued','starting','waiting');
