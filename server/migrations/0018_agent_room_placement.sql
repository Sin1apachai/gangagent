ALTER TABLE agents ADD COLUMN office_placement text NOT NULL DEFAULT 'auto' CHECK(office_placement IN ('auto','common','room'));
ALTER TABLE agents ADD COLUMN office_room_id text;
ALTER TABLE agents ADD CONSTRAINT agent_room_selection CHECK ((office_placement='room' AND office_room_id IS NOT NULL) OR (office_placement<>'room' AND office_room_id IS NULL));
ALTER TABLE agents DROP COLUMN x, DROP COLUMN y;
