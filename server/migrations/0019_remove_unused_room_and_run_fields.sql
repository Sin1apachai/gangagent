-- Room purpose belonged to the retired numeric room form.
-- Keep room order and every other layout property; invalidate stale editors.
UPDATE workspaces w
SET layout=jsonb_set(w.layout,'{rooms}',(
 SELECT coalesce(jsonb_agg(r.value-'purpose' ORDER BY r.ordinality),'[]'::jsonb)
 FROM jsonb_array_elements(w.layout->'rooms') WITH ORDINALITY r(value,ordinality)
)),layout_version=layout_version+1
WHERE jsonb_typeof(w.layout->'rooms')='array'
AND EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(w.layout->'rooms')='array' THEN w.layout->'rooms' ELSE '[]'::jsonb END) r WHERE r ? 'purpose');
-- The worker uses its in-memory prompt; usage counters and execution_context
-- provide the supported inspection paths. No reader consumes this full copy.
ALTER TABLE task_runs DROP COLUMN prompt;
