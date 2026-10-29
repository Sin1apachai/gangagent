ALTER TABLE agents ADD COLUMN character_id integer NOT NULL DEFAULT 0 CHECK(character_id BETWEEN 0 AND 11);
-- Existing agents retain a deterministic appearance instead of changing when reordered.
WITH ranked AS (SELECT id,(row_number() OVER(PARTITION BY workspace_id ORDER BY created_at,id)-1)%3 AS skin FROM agents) UPDATE agents a SET character_id=(r.skin*4)::integer FROM ranked r WHERE a.id=r.id;
