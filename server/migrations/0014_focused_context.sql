ALTER TABLE tasks DROP CONSTRAINT tasks_context_format_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_context_format_check CHECK(context_format IN ('compact','pretty','focused'));
