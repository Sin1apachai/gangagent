-- name: initial_agents_table
-- version: 0001

-- up
CREATE TABLE agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'spawning',
    created_at TEXT NOT NULL
);

CREATE INDEX idx_agents_state ON agents(state);

-- down
DROP INDEX IF EXISTS idx_agents_state;
DROP TABLE IF EXISTS agents;
