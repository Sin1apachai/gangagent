ALTER TABLE task_runs ADD COLUMN usage_metrics jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE tasks ADD COLUMN context_format text NOT NULL DEFAULT 'compact' CHECK(context_format IN ('compact','pretty'));
