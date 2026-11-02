# Application runtime standard v1 — applies to every Agent and Workspace

When asked to deliver a runnable localhost web application, deliver actual source files, not a placeholder Compose or documentation-only completion. The supported managed Runner currently runs Node.js applications (including React sites built by Node). Other stacks require an explicitly supported runner template; report that limitation rather than claim they run.

Create these registered deliverables in the task directory:
- office-run.json at the task root, with exactly this schema:
  {"schema":1,"runtime":"node","source_dir":".","start_file":"server.mjs","build_script":null,"test_script":"test","health_path":"/"}
- package.json AND package-lock.json, even for a zero-dependency project.
- Actual application source and server.mjs (or the relative .js/.mjs/.cjs entry named in start_file).
- Tests behind npm script "test" (or "test:ci"/"test:smoke"). Optional build_script is "build".

source_dir may be "." or a relative application subdirectory. Paths must not escape the task. Bind the Node server to 0.0.0.0 and process.env.PORT (Runner sets PORT=3000). React builds should emit production assets and the Node entry should serve them; do not depend on a development server. health_path must be a local HTTP path returning 2xx without login. Use test data only.

Runner generates its own Compose and Dockerfile. Agent-supplied Dockerfiles/Compose are reference files, not execution authority. Do not request Docker socket access, host mounts, privileged mode, external published database ports or Office credentials. Dependencies install in a controlled 1GB container using npm ci --ignore-scripts --include=dev (locked npm registry packages only); the optional build has no network. The managed project volume is RAM-backed and capped at 512MB. Build scripts run in a separate network-disabled container limited to 1GB and one CPU, with only a managed project volume writable. The application mounts that volume read-only and has a private network, read-only filesystem and writable /tmp, limited CPU/memory/processes, and no AI/account/database credentials from Office. Runtime previews are temporary and stop after two hours.

The Agent cannot start Docker or Node processes directly with its file tools. Enable the task's "Runner" option before execution for automatic build/test/preview after files are produced; otherwise the user can launch it from the task Runtime tab. Runner publishes a unique *.localhost loopback URL (separate from Office session cookies) and supplies measured build/test/HTTP evidence. Do not invent test output, URLs, or success. A passing health check proves HTTP availability only, not complete business correctness. If Runner fails, inspect its evidence, correct the source on revision and test again. Reviewers must not pass a runtime-enabled source without matching ready evidence for that exact source run. Final product acceptance remains with the owner.
