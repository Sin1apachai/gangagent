ALTER TABLE knowledge ADD COLUMN auto_key text,
 ADD COLUMN origin_task_id uuid REFERENCES tasks(id),
 ADD COLUMN origin_run_id uuid REFERENCES task_runs(id);
CREATE UNIQUE INDEX knowledge_auto_identity ON knowledge(workspace_id,auto_key)
 WHERE auto_key IS NOT NULL AND deleted_at IS NULL;
CREATE TABLE knowledge_versions (
 note_id uuid NOT NULL REFERENCES knowledge(id) ON DELETE CASCADE,
 version integer NOT NULL,title text NOT NULL,content text NOT NULL,source text NOT NULL,
 verified boolean NOT NULL,origin_task_id uuid REFERENCES tasks(id),origin_run_id uuid REFERENCES task_runs(id),
 deleted_at timestamptz,recorded_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(note_id,version)
);
ALTER TABLE knowledge_versions ENABLE ROW LEVEL SECURITY;
INSERT INTO knowledge_versions(note_id,version,title,content,source,verified,origin_task_id,origin_run_id,deleted_at)
 SELECT id,version,title,content,source,verified,origin_task_id,origin_run_id,deleted_at FROM knowledge;
CREATE FUNCTION record_knowledge_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' OR NEW.version<>OLD.version THEN
  INSERT INTO knowledge_versions(note_id,version,title,content,source,verified,origin_task_id,origin_run_id,deleted_at)
  VALUES(NEW.id,NEW.version,NEW.title,NEW.content,NEW.source,NEW.verified,NEW.origin_task_id,NEW.origin_run_id,NEW.deleted_at);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER knowledge_version_snapshot AFTER INSERT OR UPDATE ON knowledge FOR EACH ROW EXECUTE FUNCTION record_knowledge_version();
