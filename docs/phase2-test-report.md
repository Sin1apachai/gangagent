# Agent Office release verification — 2026-10-29

## Scope and phase results

| Phase | Delivered |
|---|---|
| 2.1 Provider acceptance | Real subscription Codex and Claude file creation, downloads, revision and human acceptance; revoked-token reconnect from Settings |
| 2.2 Architecture | Rust bootstrap/library, HTTP features, domain/application/infrastructure; React feature folders, typed controller/API/LayoutEngine; formatted sources |
| 3 RPG design | Supplied pixel assets, navy/paper/gold UI, walking agents linked to real states, grid editing, collision/bounds, rotate/copy/delete, undo/redo, zoom, keyboard and responsive UI |
| 4 Collaboration | Project CRUD, task priority/acceptance criteria, references, manager draft/import, up to8 DAG steps, explicit approval/cancel, human-gated handoff |
| 5 Knowledge | Local multilingual semantic + full-text fallback, hash cache, verified/source filtering, audited and revocable global Intelligence search |
| 6 Personal workers | One-time private Compose download, PG RLS/Redis ACL, separate AI volumes and model UID, Settings revocation; trusted local Docker host only |
| 7 Operations | Private DB/artifact backup with checksums/ACLs, claim maintenance gate, validated transactional restore into a separate project, revoked old bindings, operating docs |

## Automated checks

The latest integration suite passed37 HTTP tests in an isolated `agent-office-test` Compose project with ephemeral PostgreSQL/Redis and two fixture workers. Fixture tests never call a model. All11 Rust unit tests passed. Unit checks cover layout/plan policy, process environment/group separation, artifact and revision paths, and declarative output path/budget/symlink validation. React/TypeScript production builds passed. Test services never point at the owner's live database.

## Live subscription acceptance

After reconnecting Codex, both providers completed creation of `acceptance.txt`, an exact random-content download check, revision to a second exact marker, and acceptance as done. Workspace: `d705fa81-f06c-4cc4-aa85-7a4fefb8e104`.

A separate live three-request team test passed: Codex proposed exactly two validated steps using actual Agent IDs; the owner approved the plan; Codex produced `source.txt`; Claude stayed queued with zero attempts until human acceptance; then Claude read the copied parent file and produced `verified.txt` with the same random marker. Both step tasks were accepted. Workspace: `3749b2f2-b3ce-4931-8d56-816fb005fa67`; plan: `6c78b084-00e9-486e-9bec-95f29e7ef599`.

An earlier Codex attempt authenticated but could not write through bubblewrap because Docker default seccomp blocks nested namespaces. This was not counted as a pass. The released Codex mode uses official schema-constrained output and validates/materializes UTF-8 files, with shell tools disabled. No Docker sandbox/capability weakening was introduced. Codex does not execute generated programs or tests. See architecture.md for exact limits.

## Additional acceptance probes

- PostgreSQL worker login sees only its owner and authorized verified notes. Other-user knowledge/tasks, password hashes, SET ROLE office, membership updates and maintenance updates are denied.
- Redis worker login can consume only its owner's one-time mailbox; foreign keys, writes and ACL administration are denied. Revocation rejects subsequent PostgreSQL and Redis authentication.
- A real personal Worker with empty auth volumes registered its generated Linux account; both official CLIs completed unauthenticated status heartbeats without calling a model. A scoped Worker completed its own fixture task under a separate model UID; the read-only web app read its registered artifact through ACLs.
- Local CPU semantic service: a Thai vacation-policy question ranked the English leave-policy note first; unverified notes were excluded and source Workspace retained. Editing a note invalidated its cached result. No paid inference API was used.
- Actual backup script succeeded against the disposable preview. Restore into `agent-office-restore-check` validated both checksums, restored login/workspaces/knowledge/task history and three downloadable artifacts, and left zero active old worker bindings. A final restore preserved directory ACLs: all three files were readable by the web app and denied to an unrelated model UID. The initial empty database startup race was fixed with a bounded readiness wait and retested successfully.
- Browser checks covered login, Agent creation, furniture keyboard placement/rotation/undo/redo/save, editable plan draft, Settings and390px responsive layout. Mobile Workspace selection/addition/logout remain available; document scroll width equals viewport width. Pixel assets and actual Agent data rendered. Screenshot: screenshots/rpg-office-final.png (disposable test office).

## Operating boundaries

This is a local/trusted-host release bound to loopback. Docker operators and the root coordinator are trusted; it is not audited hostile multi-tenant hosting. No public deployment, domain purchase, email recovery, or paid API routing was added. Provider subscription quotas and optional provider-side paid-overage settings remain under the account owner's control. Backups exclude `.env` and AI credentials; reconnect providers and create new personal worker bindings after moving. Knowledge remains in PostgreSQL; Redis is disposable.

## Reproduce

Run `./test.sh` for the default isolated suite. `tests/probe_live.py` and `tests/probe_live_team.py` require explicit `OFFICE_TEST_TARGET=live_owner` and connected/enabled subscriptions. Security and semantic probes require `disposable_security` / `disposable_semantic` targets and disposable service/account environment settings. Never point those probes at production users.
