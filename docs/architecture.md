# Phase 2 architecture

## Services and trust boundaries

Browser → Rust Axum (React static files + authenticated /api) → PostgreSQL and Redis.
A separate Rust worker owns job orchestration and launches official Linux Codex/Claude CLIs. It shares only artifact storage with the web server; credential volumes are never mounted into the web server. There are no host-directory or Docker-socket mounts in runtime services.

The worker coordinator runs as container root to retain orchestration credentials separately from model subprocesses. Each real CLI subprocess runs as UID/GID 10001 with a fresh environment containing only CLI paths and non-secret settings. Database, owner password, cloud-provider and API credentials are not inherited. Model subprocesses have a separate process group; cancellation, timeout, orchestration failure or shutdown terminate that group. This is isolation inside the worker container, not a substitute for an audited hostile-code hosting service.

## Data model

Postgres is authoritative for users, hashed sessions, workspace memberships, optimistic entity versions, soft deletion, tasks, agent configurations, verified knowledge, worker heartbeats, per-attempt task runs, events and artifact metadata. Artifacts are in the `runs-data` volume. Redis retains login throttles and the original bounded wake-up hints; the worker polls durable Postgres tasks, so Redis loss cannot lose the task queue.

Owner bootstrapping remains empty apart from the owner account. No sample tasks, furniture, agents or knowledge are seeded. Original migrations are unchanged; migration 0003 adds Phase 2 tables/columns without deleting existing user records.

## Execution and recovery

Creating a task never starts a model. An explicit run request requires workspace write access, ownership of that task's provider usage, an enabled provider connection and billing acknowledgement. The worker is bound to one Agent Office user and never takes another user's tasks. Once registered, worker identity remains bound to that user even if the profile email changes; use a new worker ID when intentionally assigning a new owner.

Two workers claim tasks atomically using `FOR UPDATE ... SKIP LOCKED`. Claims lock the task; ongoing access checks and persisted cancellation stop execution when workspace access changes. Heartbeats extend a 20-second lease; cancellation, disabled connections and removed access stop running jobs. Lost leases become `interrupted` and require deliberate retry. They are not automatically replayed because external side effects may already have happened. Fencing with `current_run_id` prevents a late worker from overwriting a newer task state.

A task has at most three actual execution attempts, a 15-minute execution timeout, bounded output capture and bounded artifact collection. Unauthenticated requests are marked `waiting_auth` without increasing the actual-attempt counter. Detected quota errors stop in `waiting_quota`; no API-key fallback or automatic paid route exists. Provider-side credit settings remain the user's responsibility.

Successful execution produces `review`, not `done`. A human accepts the result or supplies revision feedback. Revisions are queued with execution disabled until explicitly started. Run history remains immutable. Only verified, active knowledge from the same workspace is included (up to 20 entries and a bounded prompt budget). Saving output as knowledge creates an unverified entry for human review.

Artifact downloads require current workspace access, active task ownership scope, canonical containment under the run directory, relative-path validation, regular-file checks and size limits. Files are always downloaded rather than executed as HTML. Symlinks are excluded during collection.

## Roles and deletion

Super Admin can manage all workspaces and regular accounts. Workspace owners manage names, deletion and membership; members manage content; viewers can only read. Membership removal cannot delete the owner role. Users cannot delete their own account or a Super Admin account via these endpoints. Password changes revoke sessions. Soft-deleted users cannot authenticate and existing sessions stop working.

Workspace, task, knowledge and agent deletion is recoverable. Active work cannot be edited or deleted; first request cancellation and wait for it to finish. Entity version checks reject stale writes. Trashing a task clears pending execution so restoring it cannot unexpectedly launch a model.

## Provider integration boundaries

Codex is forced to ChatGPT authentication, uses workspace-write with shell network disabled, and does not receive an API key. Claude must report native `claude.ai` authentication; it uses safe mode, explicit file tools, deny rules for auth/process directories, no external MCP and no permission bypass. Auth volumes persist across ordinary Compose restarts, but no host keychain is copied.

The standard test suite uses fixture workers with explicit environment/database guards, test-only results and no model calls. Real CLI probes can verify missing-login handling without calling a model. A paid subscription model request can only be tested after the owner completes official login and enables execution. The application cannot independently prove or change provider-side paid-credit settings.

## Source organization and OOP

Rust `main.rs` boots the library. `presentation/http` contains HTTP feature handlers; `domain` holds plan policies; `application` coordinates use cases; `infrastructure` stores plans and implements semantic retrieval. `auth`, `workspaces`, `worker`, `login_flow`, `collaboration`, and `personal_workers` are explicit feature modules. Existing CRUD handlers share scoped access helpers; they are not artificially wrapped in one class per table.

React uses feature folders, typed shared contracts, a controller hook, an `OfficeApi` service class, and `LayoutEngine`/`SpriteAtlas` classes. UI components remain function components. Rust encapsulation uses structs and `impl`, composition and policies rather than forced inheritance. This is a project convention, not a universal framework-mandated folder standard.

Primary references: [Rust modules](https://doc.rust-lang.org/stable/book/ch07-00-managing-growing-projects-with-packages-crates-and-modules.html), [Rust OOP](https://doc.rust-lang.org/book/ch17-00-oop.html), [Thinking in React](https://react.dev/learn/thinking-in-react), [React state structure](https://react.dev/learn/choosing-the-state-structure).

## Projects and collaboration

Projects organize tasks with priority and acceptance criteria. A goal can create an unstarted planner task; importing its reviewed JSON proposal never executes steps. Plans allow at most eight steps with backward-only dependencies and enabled agents in the same workspace. Approval explicitly acknowledges provider usage, transactionally creates tasks and dependencies, and cannot be repeated. Each dependent task waits for human acceptance of all parent tasks. The worker receives bounded parent result text and copies registered parent artifacts into `inputs/<parent-task>/`. Task references are at most five files of one MiB each. Cancellation persists across worker restarts.

## Knowledge and Super Intelligence

Verified active knowledge is searched within authorized workspaces. Super Admin or an explicitly granted, revocable Intelligence user can request cross-workspace search; searches and grants are audited and results identify their source. This does not give models a database login or arbitrary SQL.

The optional `semantic` Compose profile runs `paraphrase-multilingual-MiniLM-L12-v2` on local CPU, offline after image build. No inference API or vector database purchase is used. Model downloads occur only during build. PostgreSQL caches 384-dimensional normalized vectors by note content hash and model name. Retrieval checks authorization before selecting up to 300 recent verified notes; scores are ranking signals, not confidence percentages. Semantic results merge with PostgreSQL full-text search. If the service is unavailable or busy, the response reports the full-text fallback. This bounded implementation is for a personal/team office; larger archives require indexed vector retrieval.

## Personal workers — trusted host only

Settings issues one-time Compose downloads with a generated PostgreSQL role and Redis credential for each Worker. Only the credential hash is stored for Redis reconstruction. PostgreSQL RLS limits task access to the worker owner and writable workspace memberships; knowledge must be verified and active. The role cannot read password hashes, administer users/memberships, or become the app database owner. Redis ACL permits only that owner's one-time login mailbox. ACLs are reconstructed after a memory-only Redis restart. Revocation disables database login, terminates sessions, removes Redis access, and is audited.

Each personal Worker uses separate auth volumes and a unique model UID starting at 20000. Run directories are private; finished files receive an ACL for the read-only web app. The default owner's UID10001 can read completed outputs, consistent with owner administration. The root coordinator and Docker host operator remain trusted. This is not hostile multi-tenant container isolation, and the downloaded file must never be offered to an untrusted Docker operator or remote arbitrary host. Runtime containers have no Docker socket.

## Backup and moving

`backup.sh` pauses new claims, waits for running leases to finish, creates a private PostgreSQL dump and archive of registered artifacts with filesystem ACLs, and writes SHA256 checksums. A trap resumes claims. No AI credential volume or `.env` is included. Keep backups outside the machine as a separate operator action; the app does not upload them.

`restore.sh` requires an explicit isolated destination project and refuses the live `agent-office` project. It validates checksums and archive paths/types before restore, restores PostgreSQL transactionally, revokes old personal bindings, interrupts restored running jobs, and restores artifact ACLs. Reconnect subscriptions and create new personal Workers after moving. Operator-supplied secrets and roles are never silently reused on a different host. Keep the service loopback-only; Internet exposure, TLS/domain setup, email recovery and audited hostile-user hosting are outside this local release.

Revision runs include the latest reviewed result from the same task, bounded to 60,000 UTF-8 bytes without splitting a code point. This preserves review context through a failed retry. Registered artifacts from the latest reviewed run are copied into the new directory before execution; the previous run remains unchanged and downloadable. The UI separates the newest run downloads from historical downloads and shows worker heartbeat freshness in Settings.

Access invalidation is transactional with clearing queued execution requests and marking running jobs for cancellation. Workspace/user restoration and re-granting membership never revive a previously requested execution. Provider disable persists cancellation even after immediate re-enable.

## Browser-driven provider sign-in

Authenticated Settings can enqueue a login request for a worker bound to the same user. One active login is permitted per worker. The idle worker starts the official CLI, extracts only allowlisted authorization URLs and Codex device codes, and retains credentials in existing private volumes. It will not replace an already authenticated session. No Docker socket or host credential mount is introduced.

Claude one-time authorization input travels through memory-only Redis (no AOF or RDB snapshots), has a 60-second TTL and is consumed with GETDEL. The UI requests only one-time authorization codes and rejects API-key-shaped input. PostgreSQL records request state and short-lived public login details only; terminal/expired requests clear the URL/code. Requests expire after ten minutes, can be cancelled by their owner, and are invalidated on worker restart. Sign-in does not enable billing or execute a model task. Existing durable task state and knowledge remain in PostgreSQL; Redis remains disposable.


## Codex on Docker Desktop: declarative file mode

The installed Codex sandbox uses bubblewrap. Docker's default seccomp blocks nested namespaces on this host; a live probe authenticated successfully but could not create its requested file. We retain Docker's default seccomp, capabilities, and Codex sandbox. Codex uses official `--output-schema` instead, with shell, unified execution, multi-agent, apps/plugins and browser tools disabled, ignored user config/rules, and ephemeral sessions. The model returns a summary and complete UTF-8 file contents. The coordinator validates all paths and budgets before writing only inside the current run directory, rejects symlinks, traversal, hidden paths, duplicate names and protected input folders, then sends the result for human review.

Limits: at most20 files,256KiB per file,1MiB total,60KiB summary; text references/revision files are included in a bounded120KiB context, while binary/large files are omitted. Codex does not run shell commands, tests, package installers or arbitrary repository tools in this mode. Claude still uses file tools. No success claim implies generated code has been executed. A future full coding runner requires a supported sandbox host and a separate security review, not an automatic `--privileged`, `SYS_ADMIN`, `seccomp=unconfined`, Landlock downgrade, or sandbox bypass.

References: [OpenAI structured output](https://learn.chatgpt.com/docs/non-interactive-mode#create-structured-outputs-with-a-schema), [OpenAI sandbox enforcement](https://learn.chatgpt.com/docs/permissions#how-enforcement-works), [Docker seccomp](https://docs.docker.com/engine/security/seccomp/).
