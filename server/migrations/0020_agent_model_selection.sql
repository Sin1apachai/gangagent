ALTER TABLE agents ADD COLUMN model text CHECK(model IS NULL OR (length(model) BETWEEN 1 AND 80 AND model ~ '^[a-z0-9][a-z0-9._-]*$'));
