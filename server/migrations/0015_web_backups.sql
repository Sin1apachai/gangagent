CREATE TABLE backup_jobs(id uuid PRIMARY KEY,created_by uuid NOT NULL REFERENCES users(id),status text NOT NULL CHECK(status IN ('queued','waiting','snapshotting','archiving','ready','failed','cancelled','deleting','deleted')),cancel_requested boolean NOT NULL DEFAULT false,message text NOT NULL DEFAULT '',bytes bigint NOT NULL DEFAULT 0,sha256 text NOT NULL DEFAULT '',created_at timestamptz NOT NULL DEFAULT now(),started_at timestamptz,finished_at timestamptz);
CREATE UNIQUE INDEX one_active_backup ON backup_jobs((true)) WHERE status IN ('queued','waiting','snapshotting','archiving');
CREATE TABLE backup_service(id boolean PRIMARY KEY DEFAULT true CHECK(id),heartbeat_at timestamptz NOT NULL DEFAULT now(),pause_owned boolean NOT NULL DEFAULT false,pause_job uuid REFERENCES backup_jobs(id));
ALTER TABLE backup_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE backup_service ENABLE ROW LEVEL SECURITY;
