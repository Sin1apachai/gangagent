ALTER TABLE tasks ADD COLUMN review_mode text NOT NULL DEFAULT 'owner' CHECK(review_mode IN('owner','manager','agent')),
 ADD COLUMN review_agent_id uuid REFERENCES agents(id),
 ADD COLUMN review_for_task_id uuid REFERENCES tasks(id),
 ADD COLUMN review_source_run_id uuid REFERENCES task_runs(id),
 ADD COLUMN review_state text NOT NULL DEFAULT '',
 ADD COLUMN review_note text NOT NULL DEFAULT '';
CREATE TABLE agent_reviews (
 task_id uuid NOT NULL REFERENCES tasks(id), source_run_id uuid NOT NULL REFERENCES task_runs(id),
 review_task_id uuid NOT NULL UNIQUE REFERENCES tasks(id),
 decision jsonb, applied_at timestamptz, PRIMARY KEY(task_id,source_run_id)
);
ALTER TABLE agent_reviews ENABLE ROW LEVEL SECURITY;
