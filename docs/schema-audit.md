# Database schema cleanup

Audited on 2026-10-30 against the running PostgreSQL database, Rust SQL paths, React types, worker execution, migrations and integration tests.

## Removed in migration 0019

| Retired data | Evidence | Change |
| --- | --- | --- |
| `workspaces.layout.rooms[].purpose` | The visual room builder no longer edits/displays it. The room validator only carried it as a legacy required property. | Remove from Rust/TypeScript room contracts, room creation, fixtures and existing layout JSON. Preserve room order, geometry and all other layout properties. Increment layout_version only for changed workspaces. |
| `task_runs.prompt` | Worker inserted a complete copy, but no API, UI, retrieval path or test consumed the persisted column. Execution uses the in-memory prompt. | Stop writing the duplicate copy and drop the column. Preserve frozen execution_context, results, errors, usage metrics and run ownership/history. |

Agent x/y columns were already removed by migration 0018; their absence is verified again. Room/furniture coordinates, dimensions and door geometry are active map data and remain necessary for rendering, collisions and pathfinding.

This change does not reduce the prompt sent to an AI provider or claim token savings. It removes a duplicate persisted text field. The main database contained no run rows at audit time, so no reclaimed disk-space figure is claimed.

## Retained schema and active responsibilities

| Area | Tables |
| --- | --- |
| Accounts, workspace membership and AI/worker authentication | users, sessions, memberships, provider_connections, provider_logins, worker_bindings, workers |
| Office and agents | workspaces, agents |
| Tasks and delivery evidence | projects, tasks, task_runs, task_events, artifacts, task_attachments, task_dependencies |
| Planning and workflow | plans, workflows, workflow_versions, workflow_launches |
| Reusable skills | skills, skill_versions, agent_skills |
| Knowledge and semantic retrieval | knowledge, knowledge_embeddings |
| Personnel and master imports | master_data, master_data_imports, recruitment_applications |
| Cross-workspace intelligence authorization | intelligence_grants |
| Backup and execution pause coordination | backup_jobs, backup_service, office_maintenance |
| Resource monitoring and per-admin history | resource_settings, resource_state, resource_notifications, resource_notification_reads |
| Audit and migration provenance | audit_events, _sqlx_migrations |

All 37 application tables have explicit references in current Rust code. `_sqlx_migrations` is managed by SQLx. All 38 tables remain. Authorization policies and indexes linked to these active paths remain. Four public functions provide worker identity/access, safe maintenance coordination and immutable published skill/workflow revisions. Historical applied migration files remain unchanged so existing installations and restored backups can upgrade reliably.

## Verification

- A populated schema-18 preview contained a legacy room description and a task run with a full prompt, result and usage counters. Migration 0019 removed only the retired properties/column. The entire remaining workspace snapshot and task-run record matched their expected values exactly.
- Full Docker Compose suite passed: 86 HTTP tests, 29 Rust unit tests and 13 frontend domain/rendering tests, including worker execution, metrics, backups and room validation.
- Production was backed up before upgrade. Fingerprints across 29 stable domain tables matched their expected pre-migration values; temporary migration fixtures were isolated from production.
- Application, production Worker and backup service binaries were verified identical after deployment. All services are running and the web responds HTTP 200.
- Production inventory: 38 tables, 273 columns (previously 274), 53 indexes, 15 RLS policies and 4 public functions. The room-purpose property is JSON data, not a separate SQL column.

Machine-readable evidence: [schema-cleanup-proof.json](measurements/schema-cleanup-proof.json).
