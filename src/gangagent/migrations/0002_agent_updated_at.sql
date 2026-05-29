-- name: agent_updated_at
-- version: 0002

-- up
ALTER TABLE agents ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';
UPDATE agents SET updated_at = created_at WHERE updated_at = '';

-- down
ALTER TABLE agents DROP COLUMN updated_at;
