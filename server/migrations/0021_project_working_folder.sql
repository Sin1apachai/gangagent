ALTER TABLE projects ADD COLUMN working_folder jsonb CHECK (working_folder IS NULL OR (jsonb_typeof(working_folder)='object' AND working_folder ?& ARRAY['id','path','bridge_id']));
