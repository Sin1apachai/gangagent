use super::*;
use std::collections::{BTreeMap, BTreeSet};
type Files = BTreeMap<String, Vec<u8>>;
type Tree = BTreeMap<String, String>;
fn scan(root: &DiskPath) -> DiskResult<Files> {
    fn walk(
        root: &DiskPath,
        dir: &DiskPath,
        out: &mut Files,
        total: &mut usize,
        depth: usize,
    ) -> DiskResult<()> {
        if depth > 8 {
            return Err("Project nesting exceeds limit".into());
        }
        let meta = fs::symlink_metadata(dir).map_err(|_| "Project directory missing")?;
        if !meta.is_dir() || meta.file_type().is_symlink() {
            return Err("Project symlinks are not allowed".into());
        }
        for e in fs::read_dir(dir).map_err(|_| "Cannot read project source")? {
            let p = e.map_err(|_| "Cannot inspect source entry")?.path();
            let name = p
                .strip_prefix(root)
                .map_err(|_| "Unsafe source path")?
                .to_string_lossy()
                .into_owned();
            if !safe(&name) {
                continue;
            }
            let m = fs::symlink_metadata(&p).map_err(|_| "Source metadata unavailable")?;
            if m.file_type().is_symlink() {
                return Err("Project source symlinks are not allowed".into());
            }
            if m.is_dir() {
                walk(root, &p, out, total, depth + 1)?
            } else if m.is_file() {
                if m.len() > 10 * 1024 * 1024 || out.len() >= 100 {
                    return Err("Project exceeds 100 files / 10MB per file".into());
                }
                let b = read(&p, 10 * 1024 * 1024)?;
                *total += b.len();
                if *total > 50 * 1024 * 1024 {
                    return Err("Project exceeds 50MB".into());
                }
                out.insert(name, b);
            }
        }
        Ok(())
    }
    let mut out = Files::new();
    walk(root, root, &mut out, &mut 0, 0)?;
    Ok(out)
}
fn hashes(files: &Files) -> Tree {
    files
        .iter()
        .map(|(p, b)| (p.clone(), format!("{:x}", Sha256::digest(b))))
        .collect()
}
fn output(disk: &WorkspaceDirectory, root: &DiskPath, name: &str) -> DiskResult<PathBuf> {
    if !safe(name) {
        return Err("Unsafe project filename".into());
    }
    let mut p = root.to_path_buf();
    let parts: Vec<_> = name.split('/').collect();
    for c in &parts[..parts.len() - 1] {
        p.push(c);
        disk.dir(&p)?;
    }
    p.push(parts[parts.len() - 1]);
    if fs::symlink_metadata(&p).is_ok_and(|m| !m.is_file() || m.file_type().is_symlink()) {
        return Err("Unsafe project destination".into());
    }
    Ok(p)
}
fn project(
    disk: &WorkspaceDirectory,
    wid: Uuid,
    key: &str,
    pid: Option<Uuid>,
    slug: &str,
) -> DiskResult<PathBuf> {
    if slug.is_empty() || slug.starts_with('.') || slug.contains('/') || slug.contains('\\') {
        return Err("Unsafe project directory".into());
    }
    let p = disk.workspace(key, wid)?.join(slug);
    let existed = p.exists();
    disk.dir(&p)?;
    let marker = p.join(".office-project.json");
    if marker.exists() {
        let m: Value =
            serde_json::from_slice(&read(&marker, 8192)?).map_err(|_| "Invalid project marker")?;
        if m["workspace_id"] != wid.to_string() || m["project_id"] != json!(pid) {
            return Err("Folder belongs to another project".into());
        }
    } else {
        if existed
            && fs::read_dir(&p)
                .map_err(|_| "Cannot inspect project folder")?
                .next()
                .is_some()
        {
            return Err(
                "Existing project folder is not managed by Office; no files overwritten".into(),
            );
        }
        disk.write(
            &marker,
            &serde_json::to_vec(&json!({"workspace_id":wid,"project_id":pid})).unwrap(),
        )?;
    }
    Ok(p)
}
pub(crate) async fn prepare(
    db: &PgPool,
    task: Uuid,
    run: Uuid,
    uid: u32,
    dir: &DiskPath,
) -> std::result::Result<(), String> {
    sqlx::query("UPDATE task_runs SET usage_metrics=usage_metrics||$1 WHERE id=$2 AND task_id=$3")
        .bind(json!({"project_code_request":{"uid":uid}}))
        .bind(run)
        .bind(task)
        .execute(db)
        .await
        .map_err(|_| "Cannot request project code")?;
    for _ in 0..150 {
        let data: Value =
            sqlx::query_scalar("SELECT usage_metrics FROM task_runs WHERE id=$1 AND task_id=$2")
                .bind(run)
                .bind(task)
                .fetch_one(db)
                .await
                .map_err(|_| "Cannot read project preparation")?;
        match data["project_code_state"].as_str() {
            Some("ready" | "synced") => {
                let bridge = DiskPath::new("/project-work").join(run.to_string());
                let files = scan(&bridge)?;
                let code = dir.join("code");
                fs::create_dir(&code).map_err(|_| "Cannot create code working view")?;
                for (name, bytes) in files {
                    crate::worker::copy_revision_file(&bridge, &code, &name, bytes.len() as u64)
                        .map_err(|_| "Cannot initialize code view")?;
                }
                std::os::unix::fs::chown(&code, Some(uid), Some(uid))
                    .map_err(|_| "Cannot own working view")?;
                fs::set_permissions(&code, fs::Permissions::from_mode(0o700))
                    .map_err(|_| "Cannot protect code view")?;
                sqlx::query("UPDATE task_runs SET usage_metrics=usage_metrics||'{\"project_code_view_ready\":true}'::jsonb WHERE id=$1").bind(run).execute(db).await.map_err(|_|"Cannot acknowledge code view")?;
                return Ok(());
            }
            Some("failed" | "conflict") => {
                return Err(data["project_code_error"]
                    .as_str()
                    .unwrap_or("Project preparation failed")
                    .into())
            }
            _ => {}
        }
        sqlx::query("UPDATE tasks SET lease_until=now()+interval '60 seconds' WHERE id=$1 AND current_run_id=$2 AND status='running'").bind(task).bind(run).execute(db).await.map_err(|_|"Cannot renew preparation lease")?;
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    }
    Err("Project code bridge unavailable; no AI call was made".into())
}
async fn state(db: &PgPool, run: Uuid, value: &str, error: &str) -> Result<()> {
    sqlx::query("UPDATE task_runs SET usage_metrics=usage_metrics||$1 WHERE id=$2")
        .bind(json!({"project_code_state":value,"project_code_error":error}))
        .bind(run)
        .execute(db)
        .await?;
    sqlx::query(
        "UPDATE project_code_sessions SET state=$1,error=$2,updated_at=now() WHERE run_id=$3",
    )
    .bind(value)
    .bind(error)
    .bind(run)
    .execute(db)
    .await?;
    Ok(())
}
fn merge(
    disk: &WorkspaceDirectory,
    root: &DiskPath,
    working: &DiskPath,
    base: &Tree,
) -> DiskResult<Tree> {
    let desired = scan(working)?;
    let wanted = hashes(&desired);
    let actual = hashes(&scan(root)?);
    let changed: BTreeSet<_> = base
        .keys()
        .chain(wanted.keys())
        .filter(|p| base.get(*p) != wanted.get(*p))
        .cloned()
        .collect();
    for name in &changed {
        if actual.get(name) != base.get(name) && actual.get(name) != wanted.get(name) {
            return Err(format!("Code conflict: {name} changed on the host or in another Agent; that change was preserved"));
        }
    }
    for name in changed {
        let target = output(disk, root, &name)?;
        if let Some(b) = desired.get(&name) {
            let tmp = target.with_file_name(format!(".office-write-{}", Uuid::new_v4()));
            disk.write(&tmp, b)?;
            fs::rename(&tmp, &target).map_err(|_| "Cannot save project code")?;
        } else if target.exists() {
            fs::remove_file(&target).map_err(|_| "Cannot remove project source")?;
        }
    }
    Ok(wanted)
}
pub(super) async fn cycle(db: &PgPool) -> Result<()> {
    let disk = WorkspaceDirectory::new(PathBuf::from("/workspace"));
    let spaces: Vec<(Uuid, String)> =
        sqlx::query_as("SELECT id,directory_key FROM workspaces WHERE deleted_at IS NULL")
            .fetch_all(db)
            .await?;
    for (id, key) in spaces {
        let err = disk.workspace(&key, id).err().unwrap_or_default();
        sqlx::query("INSERT INTO workspace_directories(workspace_id,status,error) VALUES($1,$2,$3) ON CONFLICT(workspace_id) DO UPDATE SET status=EXCLUDED.status,error=EXCLUDED.error,updated_at=now()").bind(id).bind(if err.is_empty(){"ready"}else{"failed"}).bind(err).execute(db).await?;
    }
    let projects:Vec<(Uuid,Uuid,String,String)>=sqlx::query_as("SELECT p.id,p.workspace_id,w.directory_key,p.code_directory_key FROM projects p JOIN workspaces w ON w.id=p.workspace_id WHERE p.deleted_at IS NULL AND w.deleted_at IS NULL").fetch_all(db).await?;
    for (pid, wid, key, slug) in projects {
        let _ = project(&disk, wid, &key, Some(pid), &slug);
    }
    let requests:Vec<(Uuid,Uuid,Option<Uuid>,String,String,Value)>=sqlx::query_as("SELECT r.id,t.workspace_id,t.project_id,w.directory_key,coalesce(p.code_directory_key,'app'),r.usage_metrics->'project_code_request' FROM task_runs r JOIN tasks t ON t.current_run_id=r.id JOIN workspaces w ON w.id=t.workspace_id LEFT JOIN projects p ON p.id=t.project_id AND p.workspace_id=w.id WHERE EXISTS(SELECT 1 FROM users u WHERE u.id=t.created_by AND u.deleted_at IS NULL AND (u.is_super_admin OR EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=u.id AND m.workspace_id=t.workspace_id AND m.role IN('owner','member')))) AND (t.plan_id IS NULL OR EXISTS(SELECT 1 FROM plans plan WHERE plan.id=t.plan_id AND plan.status='approved')) AND (t.project_id IS NULL OR p.deleted_at IS NULL) AND r.status='running' AND t.status='running' AND NOT t.cancel_requested AND t.deleted_at IS NULL AND w.deleted_at IS NULL AND r.usage_metrics ? 'project_code_request' AND NOT EXISTS(SELECT 1 FROM project_code_sessions s WHERE s.run_id=r.id) ORDER BY r.started_at LIMIT 8").fetch_all(db).await?;
    for (run, wid, pid, key, slug, request) in requests {
        let prepared = (|| -> DiskResult<Tree> {
            let root = project(&disk, wid, &key, pid, &slug)?;
            let files = scan(&root)?;
            let bridge_root = DiskPath::new("/project-work");
            fs::set_permissions(bridge_root, fs::Permissions::from_mode(0o700))
                .map_err(|_| "Cannot protect code bridge")?;
            let code = bridge_root.join(run.to_string());
            if fs::symlink_metadata(&code).is_ok() {
                return Err("Code view already exists".into());
            }
            disk.dir(&code)?;
            for (n, b) in &files {
                let p = output(&disk, &code, n)?;
                disk.write(&p, b)?;
            }
            let _uid = request["uid"]
                .as_u64()
                .filter(|v| (10001..=60000).contains(v))
                .ok_or("Invalid model UID")?;
            Ok(hashes(&files))
        })();
        let (base, error) = match prepared {
            Ok(b) => (json!(b), String::new()),
            Err(e) => (json!({}), e),
        };
        let value = if error.is_empty() { "ready" } else { "failed" };
        sqlx::query("INSERT INTO project_code_sessions(run_id,workspace_id,project_id,relative_path,state,base,error) VALUES($1,$2,$3,$4,$5,$6,$7)").bind(run).bind(wid).bind(pid).bind(format!("workspace/{key}/{slug}")).bind(value).bind(base).bind(&error).execute(db).await?;
        state(db, run, value, &error).await?;
    }
    let sessions:Vec<(Uuid,Uuid,Option<Uuid>,String,String,Value,String,bool)>=sqlx::query_as("SELECT s.run_id,s.workspace_id,s.project_id,w.directory_key,coalesce(p.code_directory_key,'app'),s.base,r.status,(t.deleted_at IS NULL AND w.deleted_at IS NULL AND t.current_run_id=s.run_id AND NOT t.cancel_requested AND EXISTS(SELECT 1 FROM users u WHERE u.id=t.created_by AND u.deleted_at IS NULL AND (u.is_super_admin OR EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=u.id AND m.workspace_id=t.workspace_id AND m.role IN('owner','member')))) AND (t.plan_id IS NULL OR EXISTS(SELECT 1 FROM plans plan WHERE plan.id=t.plan_id AND plan.status='approved')) AND (t.project_id IS NULL OR p.deleted_at IS NULL)) FROM project_code_sessions s JOIN task_runs r ON r.id=s.run_id JOIN tasks t ON t.id=r.task_id JOIN workspaces w ON w.id=s.workspace_id LEFT JOIN projects p ON p.id=s.project_id WHERE s.state IN('ready','active','synced') AND coalesce((r.usage_metrics->>'project_code_view_ready')::boolean,false) AND NOT coalesce((r.usage_metrics->>'project_code_closed')::boolean,false) ORDER BY s.updated_at LIMIT 16").fetch_all(db).await?;
    for (run, wid, pid, key, slug, base, status, valid) in sessions {
        let handoff = DiskPath::new("/project-work").join(run.to_string());
        if fs::symlink_metadata(&handoff).is_ok_and(|m| m.is_dir() && !m.file_type().is_symlink()) {
            let _ = fs::remove_dir_all(&handoff);
        }
        if valid {
            let result = (|| {
                let root = project(&disk, wid, &key, pid, &slug)?;
                let baseline: Tree =
                    serde_json::from_value(base).map_err(|_| "Invalid code baseline")?;
                merge(
                    &disk,
                    &root,
                    &DiskPath::new("/data/runs")
                        .join(run.to_string())
                        .join("code"),
                    &baseline,
                )
            })();
            match result {
                Ok(b) => {
                    sqlx::query("UPDATE project_code_sessions SET base=$1 WHERE run_id=$2")
                        .bind(json!(b))
                        .bind(run)
                        .execute(db)
                        .await?;
                    state(
                        db,
                        run,
                        if status == "running" {
                            "active"
                        } else {
                            "synced"
                        },
                        "",
                    )
                    .await?
                }
                Err(e) => state(db, run, "conflict", &e).await?,
            }
        }
        if !valid || status != "running" {
            sqlx::query("UPDATE task_runs SET usage_metrics=usage_metrics||'{\"project_code_closed\":true}'::jsonb WHERE id=$1").bind(run).execute(db).await?;
        }
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn merge_preserves_host_edits_and_allows_nonconflicting_files() {
        let root = std::env::temp_dir().join(format!("code-{}", Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        let disk = WorkspaceDirectory {
            root: root.clone(),
            uid: unsafe { libc::getuid() },
            gid: unsafe { libc::getgid() },
        };
        let a = root.join("project");
        let b = root.join("work");
        disk.dir(&a).unwrap();
        disk.dir(&b).unwrap();
        disk.write(&a.join("a.js"), b"base").unwrap();
        disk.write(&b.join("a.js"), b"base").unwrap();
        let base = hashes(&scan(&a).unwrap());
        fs::write(a.join("a.js"), "host").unwrap();
        fs::write(b.join("a.js"), "agent").unwrap();
        assert!(merge(&disk, &a, &b, &base).is_err());
        assert_eq!(fs::read_to_string(a.join("a.js")).unwrap(), "host");
        fs::write(b.join("a.js"), "base").unwrap();
        disk.write(&b.join("b.js"), b"new").unwrap();
        assert!(merge(&disk, &a, &b, &base).is_ok());
        assert_eq!(fs::read_to_string(a.join("a.js")).unwrap(), "host");
        fs::remove_dir_all(root).unwrap();
    }
}
