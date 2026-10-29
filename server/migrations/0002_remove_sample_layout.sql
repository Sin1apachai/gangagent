-- Remove only the untouched, exact layout seeded by v0.1.0.
-- Keep all workspaces, accounts, tasks, knowledge, and user-edited layouts.
UPDATE workspaces SET layout = '{"items":[]}', layout_version = layout_version + 1, name = 'ออฟฟิศของฉัน'
WHERE name = 'My first office' AND layout_version = 0
AND layout = '{"items": [{"id": "desk-1", "kind": "desk", "x": 4, "y": 4, "rotation": 0}, {"id": "desk-2", "kind": "desk", "x": 9, "y": 4, "rotation": 0}, {"id": "desk-3", "kind": "desk", "x": 14, "y": 4, "rotation": 0}, {"id": "plant-1", "kind": "plant", "x": 2, "y": 2, "rotation": 0}, {"id": "books-1", "kind": "bookshelf", "x": 17, "y": 2, "rotation": 0}, {"id": "sofa-1", "kind": "sofa", "x": 3, "y": 9, "rotation": 0}]}'::jsonb;
