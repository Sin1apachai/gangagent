CREATE TABLE office_maintenance(id boolean PRIMARY KEY DEFAULT true CHECK(id),paused boolean NOT NULL DEFAULT false);
INSERT INTO office_maintenance VALUES(true,false);
CREATE FUNCTION office_worker_paused() RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public AS $$ SELECT paused FROM public.office_maintenance WHERE id FOR SHARE $$;
