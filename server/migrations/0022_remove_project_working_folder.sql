-- Keep migration 0021 for databases that already applied it; remove the withdrawn feature.
ALTER TABLE projects DROP COLUMN working_folder;
UPDATE tasks SET execution_context=execution_context-'project_folder'
WHERE execution_context ? 'project_folder';
