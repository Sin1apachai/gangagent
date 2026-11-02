use super::*;
use policy::{project, Manifest};
use std::path::Path as FsPath;
use tokio::{io::AsyncReadExt, process::Command};
type R<T> = std::result::Result<T, String>;
#[derive(FromRow, Clone)]
struct Job {
    id: Uuid,
    workspace_id: Uuid,
    task_id: Uuid,
    source_run_id: Uuid,
    created_by: Uuid,
    port: i32,
}
struct Engine {
    db: PgPool,
    id: Uuid,
}
fn tail(s: &str, max: usize) -> String {
    let mut i = s.len().saturating_sub(max);
    while !s.is_char_boundary(i) {
        i += 1;
    }
    s[i..].into()
}
impl Engine {
    async fn append(&self, text: &str) -> R<()> {
        sqlx::query(
            "UPDATE runtime_jobs SET log=right(log||$1,120000),updated_at=now() WHERE id=$2",
        )
        .bind(tail(text, 64000))
        .bind(self.id)
        .execute(&self.db)
        .await
        .map_err(|_| "Could not save runtime log")?;
        Ok(())
    }
    async fn cancelled(&self) -> R<bool> {
        let stop:bool=sqlx::query_scalar("SELECT r.stop_requested OR NOT EXISTS(SELECT 1 FROM tasks t JOIN workspaces w ON w.id=t.workspace_id JOIN users u ON u.id=r.created_by WHERE t.id=r.task_id AND t.current_run_id=r.source_run_id AND t.status IN('review','done') AND t.deleted_at IS NULL AND w.deleted_at IS NULL AND u.deleted_at IS NULL AND (t.plan_id IS NULL OR EXISTS(SELECT 1 FROM plans p WHERE p.id=t.plan_id AND p.status='approved')) AND (u.is_super_admin OR EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=u.id AND m.workspace_id=w.id AND m.role IN('owner','member')))) FROM runtime_jobs r WHERE r.id=$1").bind(self.id).fetch_one(&self.db).await.map_err(|_|"Cannot check cancellation")?;
        if stop {
            sqlx::query("UPDATE runtime_jobs SET stop_requested=true WHERE id=$1")
                .bind(self.id)
                .execute(&self.db)
                .await
                .map_err(|_| "Cannot record cancellation")?;
        }
        Ok(stop)
    }
    async fn command(&self, args: &[String], timeout: u64, cancellable: bool) -> R<String> {
        if cancellable && self.cancelled().await? {
            return Err("Runtime cancelled or source permissions changed".into());
        }
        let mut c = Command::new("docker");
        c.args(args)
            .env_clear()
            .env("PATH", "/usr/local/bin:/usr/bin:/bin")
            .env("HOME", "/runner")
            .env("DOCKER_CONFIG", "/runner/docker-config")
            .env("DOCKER_HOST", "unix:///var/run/docker.sock")
            .env("DOCKER_BUILDKIT", "1")
            .env("BUILDKIT_PROGRESS", "plain")
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true);
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            c.as_std_mut().process_group(0);
        }
        let mut child = c.spawn().map_err(|_| "Docker CLI unavailable")?;
        let stdout = child.stdout.take().unwrap();
        let mut stderr = child.stderr.take().unwrap();
        let reader = |mut pipe: tokio::process::ChildStdout| async move {
            let mut result = String::new();
            let mut bytes = [0u8; 8192];
            while let Ok(n) = pipe.read(&mut bytes).await {
                if n == 0 {
                    break;
                }
                result = tail(&(result + &String::from_utf8_lossy(&bytes[..n])), 64000);
            }
            result
        };
        let out = tokio::spawn(reader(stdout));
        let err = tokio::spawn(async move {
            let mut result = String::new();
            let mut bytes = [0u8; 8192];
            while let Ok(n) = stderr.read(&mut bytes).await {
                if n == 0 {
                    break;
                }
                result = tail(&(result + &String::from_utf8_lossy(&bytes[..n])), 64000);
            }
            result
        });
        let start = std::time::Instant::now();
        let mut ticks = 0;
        let status = loop {
            if let Some(s) = child
                .try_wait()
                .map_err(|_| "Cannot read Docker command status")?
            {
                break Some(s);
            }
            if start.elapsed().as_secs() > timeout {
                #[cfg(unix)]
                if let Some(pid) = child.id() {
                    unsafe {
                        libc::kill(-(pid as i32), libc::SIGKILL);
                    }
                }
                let _ = child.kill().await;
                break None;
            }
            if cancellable {
                let stop = self.cancelled().await?;
                if stop {
                    let _ = sqlx::query("UPDATE runtime_jobs SET stop_requested=true WHERE id=$1")
                        .bind(self.id)
                        .execute(&self.db)
                        .await;
                    #[cfg(unix)]
                    if let Some(pid) = child.id() {
                        unsafe {
                            libc::kill(-(pid as i32), libc::SIGKILL);
                        }
                    }
                    let _ = child.kill().await;
                    break None;
                }
            }
            ticks += 1;
            if ticks % 5 == 0 {
                heartbeat(&self.db, "ready").await?;
            }
            tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        };
        let _ = child.wait().await;
        let output = format!(
            "{}{}",
            out.await.unwrap_or_default(),
            err.await.unwrap_or_default()
        );
        if status.is_some_and(|s| s.success()) {
            Ok(output)
        } else {
            self.append(&format!(
                "\n{output}\nCommand failed, cancelled or timed out.\n"
            ))
            .await?;
            Err("Docker operation failed, cancelled or timed out; inspect the runtime log".into())
        }
    }
    async fn stage(&self, status: &str, label: &str) -> R<()> {
        sqlx::query(
            "UPDATE runtime_jobs SET status=$1,evidence=evidence||jsonb_build_object('phase',$1::text),updated_at=now() WHERE id=$2 AND NOT stop_requested",
        )
        .bind(status)
        .bind(self.id)
        .execute(&self.db)
        .await
        .map_err(|_| "Cannot update runtime state")?;
        self.append(&format!("\n=== {label} ===\n")).await
    }
    async fn cleanup(&self, dir: &FsPath) -> R<()> {
        let label = format!("label=office.job={}", self.id);
        let ids = self
            .command(
                &[
                    "ps".into(),
                    "-aq".into(),
                    "--filter".into(),
                    label,
                    "--filter".into(),
                    "label=office.scope=preview".into(),
                ],
                15,
                false,
            )
            .await?;
        for id in ids.lines() {
            if !id.is_empty() && id.len() <= 64 && id.bytes().all(|c| c.is_ascii_hexdigit()) {
                self.command(&["rm".into(), "-f".into(), id.into()], 30, false)
                    .await?;
            }
        }
        let file = dir.join("compose.office.json");
        if file.is_file() {
            let mut args = compose_args(self.id, dir);
            args.extend(["down".into(), "--volumes".into(), "--remove-orphans".into()]);
            self.command(&args, 45, false).await?;
        }
        let image = format!("{}:local", project(self.id));
        // Removing a missing image is harmless; the name is generated solely from this job UUID.
        let _ = self
            .command(&["image".into(), "rm".into(), image], 20, false)
            .await;
        if dir.exists() {
            std::fs::remove_dir_all(dir)
                .map_err(|_| "Cannot remove private runtime staging files")?;
        }
        Ok(())
    }
}
fn compose_args(id: Uuid, dir: &FsPath) -> Vec<String> {
    vec![
        "compose".into(),
        "--project-name".into(),
        project(id),
        "--file".into(),
        dir.join("compose.office.json").to_string_lossy().into(),
    ]
}
async fn heartbeat(db: &PgPool, message: &str) -> R<()> {
    sqlx::query("INSERT INTO runtime_runner(id,message) VALUES(true,$1) ON CONFLICT(id) DO UPDATE SET heartbeat_at=now(),message=EXCLUDED.message").bind(message).execute(db).await.map_err(|_|"Cannot update Runner heartbeat")?;
    Ok(())
}
async fn valid_source(db: &PgPool, j: &Job) -> R<bool> {
    sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM tasks t JOIN workspaces w ON w.id=t.workspace_id JOIN users u ON u.id=t.created_by WHERE t.id=$1 AND t.workspace_id=$2 AND t.current_run_id=$3 AND t.created_by=$4 AND t.status IN('review','done') AND t.deleted_at IS NULL AND w.deleted_at IS NULL AND u.deleted_at IS NULL AND (u.is_super_admin OR EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=u.id AND m.workspace_id=w.id AND m.role IN('owner','member'))))").bind(j.task_id).bind(j.workspace_id).bind(j.source_run_id).bind(j.created_by).fetch_one(db).await.map_err(|_|"Cannot validate source task".into())
}
fn copy_file(root: &FsPath, dest: &FsPath, name: &str, size: i64) -> R<()> {
    if !policy::permitted_file(name) || size < 0 || size > 10 * 1024 * 1024 {
        return Err("Unsafe or oversized source file".into());
    }
    let mut p = root.to_path_buf();
    for c in FsPath::new(name).components() {
        p.push(c);
        let m = p.symlink_metadata().map_err(|_| "Source file missing")?;
        if m.file_type().is_symlink() {
            return Err("Symlinks are not allowed in runtime sources".into());
        }
    }
    let meta = p.metadata().map_err(|_| "Source file unavailable")?;
    if !meta.is_file() || meta.len() != size as u64 {
        return Err("Source file changed or is not regular".into());
    }
    let target = dest.join(name);
    std::fs::create_dir_all(target.parent().unwrap())
        .map_err(|_| "Cannot stage source directory")?;
    std::fs::copy(p, target).map_err(|_| "Cannot stage source file")?;
    Ok(())
}
fn package_policy(dir: &FsPath) -> R<()> {
    for name in ["package.json", "package-lock.json"] {
        let bytes = std::fs::read(dir.join(name))
            .map_err(|_| "package.json and package-lock.json are required")?;
        if bytes.len() > 2 * 1024 * 1024 {
            return Err("Package metadata exceeds size limit".into());
        }
        let v: Value = serde_json::from_slice(&bytes).map_err(|_| "Invalid package metadata")?;
        if name == "package.json" {
            if v.get("workspaces").is_some() {
                return Err(
                    "Workspace dependencies are not supported by this runner template".into(),
                );
            }
            for field in ["dependencies", "devDependencies", "optionalDependencies"] {
                if let Some(deps) = v[field].as_object() {
                    for value in deps.values() {
                        let s = value.as_str().ok_or("Invalid dependency version")?;
                        if s.contains(':') || s.contains('/') || s.contains('\\') {
                            return Err(
                                "Only locked npm registry dependencies are supported".into()
                            );
                        }
                    }
                }
            }
        }
        if name == "package-lock.json" {
            if v["lockfileVersion"].as_i64() != Some(3) {
                return Err("Use an npm v3 lockfile".into());
            }
            if let Some(packages) = v["packages"].as_object() {
                for (name, p) in packages {
                    if name.split('/').any(|s| s == "..") || p["link"] == true {
                        return Err("Linked dependencies are not supported".into());
                    }
                    if let Some(url) = p["resolved"].as_str() {
                        if !url.starts_with("https://registry.npmjs.org/") {
                            return Err("Package downloads must use registry.npmjs.org".into());
                        }
                    }
                }
            }
        }
    }
    Ok(())
}
async fn prepare(db: &PgPool, j: &Job, dir: &FsPath) -> R<Manifest> {
    let root = std::fs::canonicalize(FsPath::new("/data/runs").join(j.source_run_id.to_string()))
        .map_err(|_| "Source run directory unavailable")?;
    let files: Vec<(String, i64)> = sqlx::query_as(
        "SELECT name,size FROM artifacts WHERE task_id=$1 AND run_id=$2 ORDER BY name LIMIT 101",
    )
    .bind(j.task_id)
    .bind(j.source_run_id)
    .fetch_all(db)
    .await
    .map_err(|_| "Cannot read artifact registry")?;
    let (manifest_name, manifest_size) = files
        .iter()
        .find(|(name, _)| name == "code/office-run.json")
        .or_else(|| files.iter().find(|(name, _)| name == "office-run.json"))
        .ok_or("office-run.json is missing; follow the application runtime standard")?;
    if *manifest_size > 8192 || *manifest_size < 0 {
        return Err("Runtime manifest size invalid".into());
    }
    std::fs::create_dir_all(dir).map_err(|_| "Cannot create private staging directory")?;
    let manifest_dir = dir.join("manifest");
    copy_file(&root, &manifest_dir, manifest_name, *manifest_size)?;
    let mut m = Manifest::parse(
        &std::fs::read(manifest_dir.join(manifest_name)).map_err(|_| "Cannot read manifest")?,
    )?;
    if manifest_name.starts_with("code/") {
        m.source_dir = if m.source_dir == "." {
            "code".into()
        } else {
            format!("code/{}", m.source_dir)
        };
    }
    let source = dir.join("source");
    std::fs::create_dir_all(&source).map_err(|_| "Cannot create source staging")?;
    let mut total = 0;
    let mut count = 0;
    for (name, size) in files {
        if !policy::permitted_file(&name) || name == "office-run.json" || name == "result.md" {
            continue;
        }
        let relative = if m.source_dir == "." {
            name.as_str()
        } else {
            let prefix = format!("{}/", m.source_dir);
            let Some(p) = name.strip_prefix(&prefix) else {
                continue;
            };
            p
        };
        if !policy::permitted_file(relative) {
            return Err("Unsafe relative application path".into());
        }
        count += 1;
        total += size;
        if count > 100 || size < 0 || total > 50 * 1024 * 1024 {
            return Err("Runtime source budget exceeded".into());
        }
        let mut p = root.to_path_buf();
        for c in FsPath::new(&name).components() {
            p.push(c);
            if p.symlink_metadata()
                .map_err(|_| "Source unavailable")?
                .file_type()
                .is_symlink()
            {
                return Err("Source symlink rejected".into());
            }
        }
        let base = if m.source_dir == "." {
            root.clone()
        } else {
            root.join(&m.source_dir)
        };
        copy_file(&base, &source, relative, size)?;
    }
    package_policy(&source)?;
    if !source.join(&m.start_file).is_file() {
        return Err("Node entry file is missing".into());
    }
    std::fs::write(dir.join("Dockerfile.office"), policy::dockerfile(j.id, &m))
        .map_err(|_| "Cannot write managed Dockerfile")?;
    std::fs::write(
        dir.join("compose.office.json"),
        serde_json::to_vec_pretty(&policy::compose(j.id, j.port, &m)).unwrap(),
    )
    .map_err(|_| "Cannot write managed Compose")?;
    Ok(m)
}
async fn execute(db: &PgPool, j: &Job, dir: &FsPath) -> R<()> {
    let e = Engine {
        db: db.clone(),
        id: j.id,
    };
    if !valid_source(db, j).await? {
        return Err("Source task changed or permissions were revoked".into());
    }
    let m = prepare(db, j, dir).await?;
    e.stage("building", "Build managed image").await?;
    let mut args = compose_args(j.id, dir);
    args.extend(["build".into(), "app".into()]);
    let log = e.command(&args, 600, true).await?;
    e.append(&log).await?;
    let mut seed = compose_args(j.id, dir);
    seed.extend([
        "up".into(),
        "-d".into(),
        "--wait".into(),
        "workspace".into(),
    ]);
    let log = e.command(&seed, 40, true).await?;
    e.append(&log).await?;
    e.append("\n=== Install locked dependencies (hooks disabled, bounded workspace) ===\n")
        .await?;
    let mut install = compose_args(j.id, dir);
    install.extend([
        "run".into(),
        "--rm".into(),
        "--no-deps".into(),
        "installer".into(),
        "npm".into(),
        "ci".into(),
        "--include=dev".into(),
        "--ignore-scripts".into(),
        "--no-audit".into(),
        "--no-fund".into(),
    ]);
    let log = e.command(&install, 180, true).await?;
    e.append(&log).await?;
    if m.build_script.is_some() {
        e.stage(
            "building",
            "Build application (network disabled, 1GB limit)",
        )
        .await?;
        let mut args = compose_args(j.id, dir);
        args.extend([
            "run".into(),
            "--rm".into(),
            "--no-deps".into(),
            "builder".into(),
            "npm".into(),
            "run".into(),
            "build".into(),
        ]);
        let log = e.command(&args, 180, true).await?;
        e.append(&log).await?;
    }
    sqlx::query(
        "UPDATE runtime_jobs SET evidence=evidence||'{\"build_passed\":true}'::jsonb WHERE id=$1",
    )
    .bind(j.id)
    .execute(db)
    .await
    .map_err(|_| "Cannot record build evidence")?;
    e.stage("testing", "Run application tests").await?;
    let mut args = compose_args(j.id, dir);
    args.extend([
        "run".into(),
        "--rm".into(),
        "--no-deps".into(),
        "app".into(),
        "npm".into(),
        "run".into(),
        m.test_script.clone().ok_or("A test script is required")?,
    ]);
    let log = e.command(&args, 120, true).await?;
    e.append(&log).await?;
    sqlx::query(
        "UPDATE runtime_jobs SET evidence=evidence||'{\"tests_passed\":true}'::jsonb WHERE id=$1",
    )
    .bind(j.id)
    .execute(db)
    .await
    .map_err(|_| "Cannot record test evidence")?;
    e.stage("starting", "Start localhost preview").await?;
    let mut args = compose_args(j.id, dir);
    args.extend([
        "up".into(),
        "-d".into(),
        "--no-build".into(),
        "app".into(),
        "gateway".into(),
    ]);
    let log = e.command(&args, 180, true).await?;
    e.append(&log).await?;
    let url = format!("http://gateway:3000{}", m.health_path);
    let host = format!("preview-{}.localhost:{}", j.id.simple(), j.port);
    let script=format!("const q=require('node:http').get({},{{headers:{{host:{}}}}},r=>{{console.log('HTTP '+r.statusCode);r.resume();r.on('end',()=>process.exit(r.statusCode>=200&&r.statusCode<300?0:1));}});q.on('error',()=>process.exit(1));q.setTimeout(2500,()=>{{q.destroy();process.exit(1);}});",serde_json::to_string(&url).unwrap(),serde_json::to_string(&host).unwrap());
    let mut healthy = false;
    for _ in 0..15 {
        let args = vec![
            "run".into(),
            "--rm".into(),
            "--label".into(),
            "office.scope=preview".into(),
            "--label".into(),
            format!("office.job={}", j.id),
            "--network".into(),
            format!("{}_default", project(j.id)),
            "--user=1000:1000".into(),
            "--read-only".into(),
            "--cap-drop=ALL".into(),
            "--security-opt=no-new-privileges:true".into(),
            "--memory=128m".into(),
            "--pids-limit=32".into(),
            "node:22-bookworm-slim".into(),
            "node".into(),
            "-e".into(),
            script.clone(),
        ];
        if let Ok(log) = e.command(&args, 30, true).await {
            e.append(&log).await?;
            healthy = true;
            break;
        }
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
    }
    if !healthy {
        return Err("HTTP health check failed; bind to 0.0.0.0:3000 and check health_path".into());
    }
    let gateway = e
        .command(
            &[
                "ps".into(),
                "-q".into(),
                "--filter".into(),
                format!("label=office.job={}", j.id),
                "--filter".into(),
                "label=office.role=gateway".into(),
            ],
            10,
            true,
        )
        .await?;
    let container = gateway
        .lines()
        .next()
        .filter(|s| !s.is_empty() && s.bytes().all(|b| b.is_ascii_hexdigit()))
        .ok_or("Gateway container unavailable")?;
    let bindings = e
        .command(
            &[
                "inspect".into(),
                container.into(),
                "--format".into(),
                "{{json .NetworkSettings.Ports}}".into(),
            ],
            10,
            true,
        )
        .await?;
    let bindings: Value =
        serde_json::from_str(&bindings).map_err(|_| "Cannot inspect published ports")?;
    if !bindings["3000/tcp"].as_array().is_some_and(|a| {
        a.iter().any(|p| {
            p["HostIp"] == "127.0.0.1"
                && p["HostPort"].as_str() == Some(j.port.to_string().as_str())
        })
    }) {
        return Err("Gateway loopback port was not actually published".into());
    }
    if !valid_source(db, j).await? {
        return Err("Source changed before preview was ready".into());
    }
    let evidence = json!({"source_run_id":j.source_run_id,"build_passed":true,"tests_passed":true,"http_passed":true,"host_port_published":true,"test_script":m.test_script,"health_path":m.health_path,"standard_version":2,"url":policy::preview_url(j.id,j.port),"scope":"build, declared test command and HTTP availability; business acceptance remains separate"});
    let n=sqlx::query("UPDATE runtime_jobs SET status='ready',evidence=$1,expires_at=now()+interval '2 hours',updated_at=now() WHERE id=$2 AND NOT stop_requested").bind(evidence).bind(j.id).execute(db).await.map_err(|_|"Cannot publish runtime evidence")?.rows_affected();
    if n == 0 {
        return Err("Preview cancelled before readiness".into());
    }
    e.append("\nPreview ready. Expires in 2 hours.\n").await?;
    Ok(())
}
async fn cleanup_job(db: &PgPool, id: Uuid, stopped: bool, error: &str) -> R<()> {
    let e = Engine { db: db.clone(), id };
    let dir = FsPath::new("/runner/jobs").join(id.to_string());
    let clean = e.cleanup(&dir).await;
    let status = if stopped && clean.is_ok() {
        "stopped"
    } else {
        "failed"
    };
    let message = if let Err(s) = &clean {
        format!("{error}; cleanup pending: {s}")
    } else {
        error.to_owned()
    };
    sqlx::query(
        "UPDATE runtime_jobs SET evidence=evidence||CASE WHEN $1='failed' THEN jsonb_build_object('failed_phase',status)||CASE WHEN status='building' THEN '{\"build_passed\":false}'::jsonb WHEN status='testing' THEN '{\"tests_passed\":false}'::jsonb WHEN status='starting' THEN '{\"http_passed\":false}'::jsonb ELSE '{}'::jsonb END ELSE '{}'::jsonb END,status=$1,error=CASE WHEN $2='' THEN error ELSE $2 END,stop_requested=$3,updated_at=now() WHERE id=$4",
    )
    .bind(status)
    .bind(message)
    .bind(clean.is_err())
    .bind(id)
    .execute(db)
    .await
    .map_err(|_| "Cannot record cleanup result")?;
    Ok(())
}
pub(crate) async fn run_worker() -> R<()> {
    let db = PgPool::connect(&std::env::var("DATABASE_URL").map_err(|_| "DATABASE_URL required")?)
        .await
        .map_err(|_| "Runner database unavailable")?;
    std::fs::create_dir_all("/runner/jobs").map_err(|_| "Runner storage unavailable")?;
    crate::workspace_code::start(db.clone());
    // Long builds must not make a healthy, busy Runner appear offline.
    let heartbeat_db = db.clone();
    tokio::spawn(async move {
        loop {
            let _ = sqlx::query("UPDATE runtime_runner SET heartbeat_at=now() WHERE id")
                .execute(&heartbeat_db)
                .await;
            tokio::time::sleep(std::time::Duration::from_secs(5)).await;
        }
    });

    // Interrupted builds are never silently replayed. Cleanup is limited to their generated IDs.
    sqlx::query("UPDATE runtime_jobs SET stop_requested=true,status='stopping',error='Runner restarted during execution; request a new run after cleanup' WHERE status IN('building','testing','starting')").execute(&db).await.map_err(|_|"Cannot recover runtime state")?;
    loop {
        let health = Engine {
            db: db.clone(),
            id: Uuid::nil(),
        }
        .command(
            &[
                "info".into(),
                "--format".into(),
                "{{.ServerVersion}}".into(),
            ],
            10,
            false,
        )
        .await;
        if health.is_err() {
            heartbeat(&db, "Docker unavailable").await?;
            tokio::time::sleep(std::time::Duration::from_secs(3)).await;
            continue;
        }
        heartbeat(&db, "ready").await?;
        sqlx::query("UPDATE runtime_jobs r SET stop_requested=true,status='stopping' WHERE r.status IN('queued','ready') AND (r.expires_at<now() OR EXISTS(SELECT 1 FROM tasks t JOIN workspaces w ON w.id=t.workspace_id JOIN users u ON u.id=r.created_by WHERE t.id=r.task_id AND (t.deleted_at IS NOT NULL OR w.deleted_at IS NOT NULL OR u.deleted_at IS NOT NULL OR t.current_run_id IS DISTINCT FROM r.source_run_id OR t.status NOT IN('review','done') OR (t.plan_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM plans p WHERE p.id=t.plan_id AND p.status='approved')) OR (NOT u.is_super_admin AND NOT EXISTS(SELECT 1 FROM memberships m WHERE m.workspace_id=w.id AND m.user_id=u.id AND m.role IN('owner','member'))))))").execute(&db).await.map_err(|_|"Cannot reconcile expired previews")?;
        let stops: Vec<Uuid> =
            sqlx::query_scalar("SELECT id FROM runtime_jobs WHERE stop_requested LIMIT 8")
                .fetch_all(&db)
                .await
                .map_err(|_| "Cannot read runtime stops")?;
        for id in stops {
            cleanup_job(&db, id, true, "").await?;
        }
        let ready: Vec<Uuid> =
            sqlx::query_scalar("SELECT id FROM runtime_jobs WHERE status='ready'")
                .fetch_all(&db)
                .await
                .map_err(|_| "Cannot inspect ready previews")?;
        for id in ready {
            let e = Engine { db: db.clone(), id };
            let ids = e
                .command(
                    &[
                        "ps".into(),
                        "-q".into(),
                        "--filter".into(),
                        format!("label=office.job={id}"),
                        "--filter".into(),
                        "label=office.scope=preview".into(),
                    ],
                    10,
                    false,
                )
                .await?;
            if ids.lines().filter(|s| !s.trim().is_empty()).count() < 3 {
                cleanup_job(
                    &db,
                    id,
                    false,
                    "Application exited; inspect logs and request a new run",
                )
                .await?;
            }
        }
        if !sqlx::query_scalar::<_, bool>("SELECT office_worker_paused()")
            .fetch_one(&db)
            .await
            .map_err(|_| "Cannot check maintenance")?
        {
            let mut tx = db.begin().await.map_err(|_| "Cannot claim runtime job")?;
            let j:Option<Job>=sqlx::query_as("UPDATE runtime_jobs SET status='building',updated_at=now() WHERE id=(SELECT id FROM runtime_jobs WHERE status='queued' AND NOT stop_requested ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING id,workspace_id,task_id,source_run_id,created_by,port").fetch_optional(&mut *tx).await.map_err(|_|"Cannot claim runtime job")?;
            tx.commit()
                .await
                .map_err(|_| "Cannot commit runtime claim")?;
            if let Some(j) = j {
                let dir = FsPath::new("/runner/jobs").join(j.id.to_string());
                if let Err(error) = execute(&db, &j, &dir).await {
                    let stop: bool =
                        sqlx::query_scalar("SELECT stop_requested FROM runtime_jobs WHERE id=$1")
                            .bind(j.id)
                            .fetch_one(&db)
                            .await
                            .map_err(|_| "Cannot read stop state")?;
                    cleanup_job(&db, j.id, stop, &error).await?;
                }
            }
        }
        tokio::time::sleep(std::time::Duration::from_secs(2)).await;
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn copy_rejects_symlink_and_changed_size() {
        let dir = std::env::temp_dir().join(format!("runtime-policy-{}", Uuid::new_v4()));
        std::fs::create_dir_all(dir.join("source")).unwrap();
        std::fs::write(dir.join("source/a.js"), "safe").unwrap();
        assert!(copy_file(&dir.join("source"), &dir.join("dest"), "a.js", 4).is_ok());
        assert!(copy_file(&dir.join("source"), &dir.join("dest"), "a.js", 3).is_err());
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink("a.js", dir.join("source/link.js")).unwrap();
            assert!(copy_file(&dir.join("source"), &dir.join("dest"), "link.js", 4).is_err());
        }
        std::fs::remove_dir_all(dir).unwrap();
    }
}
