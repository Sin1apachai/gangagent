use super::*;
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::{
    fs,
    io::{Read, Write},
    path::{Path as DiskPath, PathBuf},
};
const STANDARD: &str = include_str!("../standards/workspace-code-v1.md");
type DiskResult<T> = std::result::Result<T, String>;
pub(crate) fn standard() -> Value {
    json!({"id":"workspace-code-export","version":1,"title":"โฟลเดอร์โค้ดแยกตาม Workspace","instructions":STANDARD,"checksum":digest(STANDARD)})
}
pub(crate) fn prompt(context: Option<&Value>) -> String {
    if context
        .and_then(|c| c["standards"].as_array())
        .is_some_and(|a| a.iter().any(|s| s["id"] == "workspace-code-export"))
    {
        String::new()
    } else {
        format!("\n{STANDARD}\n")
    }
}
pub(crate) async fn import(db: &PgPool) -> Result<()> {
    sqlx::query("INSERT INTO system_standards(id,version,title,instructions,checksum) VALUES('workspace-code-export',1,$1,$2,$3) ON CONFLICT(id,version) DO UPDATE SET instructions=EXCLUDED.instructions,checksum=EXCLUDED.checksum").bind(standard()["title"].as_str()).bind(STANDARD).bind(digest(STANDARD)).execute(db).await?;
    Ok(())
}
pub(crate) fn name_error(e: sqlx::Error) -> Error {
    if e.as_database_error()
        .is_some_and(|d| d.is_unique_violation())
    {
        Error(
            StatusCode::CONFLICT,
            "ชื่อ Workspace หรือชื่อโฟลเดอร์นี้ถูกใช้แล้ว รวมถึงรายการในถังขยะ กรุณาใช้ชื่ออื่น",
        )
    } else {
        e.into()
    }
}
pub(crate) async fn key(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    name: &str,
) -> Result<String> {
    let key: String = sqlx::query_scalar("SELECT office_directory_key($1)")
        .bind(name)
        .fetch_one(&mut **tx)
        .await?;
    if key.is_empty() || key.len() > 160 {
        return Err(bad("Workspace name must contain a usable folder name"));
    }
    Ok(key)
}
pub(crate) fn routes() -> Router<App> {
    Router::new().route("/workspaces/{wid}/tasks/{tid}/code-folder", get(inventory))
}
async fn inventory(
    State(a): State<App>,
    h: HeaderMap,
    Path((wid, tid)): Path<(Uuid, Uuid)>,
) -> Result<Json<Value>> {
    let u = user(&a, &h).await?;
    access(&a, &u, wid, false).await?;
    let key:Option<String>=sqlx::query_scalar("SELECT w.directory_key FROM workspaces w JOIN tasks t ON t.workspace_id=w.id WHERE w.id=$1 AND t.id=$2 AND t.deleted_at IS NULL").bind(wid).bind(tid).fetch_optional(&a.db).await?;
    let key = key.ok_or(Error(StatusCode::NOT_FOUND, "Task not found"))?;
    let runs:Vec<Value>=sqlx::query_scalar("SELECT to_jsonb(e)-'manifest' FROM workspace_code_exports e WHERE workspace_id=$1 AND task_id=$2 ORDER BY updated_at DESC LIMIT 50").bind(wid).bind(tid).fetch_all(&a.db).await?;
    let directory: Option<Value> =
        sqlx::query_scalar("SELECT to_jsonb(d) FROM workspace_directories d WHERE workspace_id=$1")
            .bind(wid)
            .fetch_optional(&a.db)
            .await?;
    Ok(Json(
        json!({"root":format!("workspace/{key}"),"directory":directory,"runs":runs}),
    ))
}
fn safe(name: &str) -> bool {
    phase2::safe_relative(name)
        && !name
            .chars()
            .any(|c| c.is_control() || c == '\\' || c == ':')
        && !name.split('/').any(|p| {
            matches!(
                p,
                "node_modules"
                    | ".git"
                    | ".codex"
                    | ".claude"
                    | ".ssh"
                    | ".npmrc"
                    | "auth.json"
                    | ".credentials.json"
                    | ".office-export.json"
                    | ".office-workspace.json"
            ) || (p.starts_with(".env") && p != ".env.example")
        })
        && !name.starts_with("inputs/")
        && !name.starts_with("references/")
        && name != "result.md"
}

struct WorkspaceDirectory {
    root: PathBuf,
    uid: u32,
    gid: u32,
}
impl WorkspaceDirectory {
    fn new(root: PathBuf) -> Self {
        Self {
            root,
            uid: std::env::var("WORKSPACE_OWNER_UID")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(1000),
            gid: std::env::var("WORKSPACE_OWNER_GID")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(1000),
        }
    }
    fn owned(&self, p: &DiskPath, mode: u32) -> DiskResult<()> {
        fs::set_permissions(p, fs::Permissions::from_mode(mode))
            .map_err(|_| "Cannot set export permissions")?;
        std::os::unix::fs::chown(p, Some(self.uid), Some(self.gid))
            .map_err(|_| "Cannot set export ownership")?;
        Ok(())
    }
    fn dir(&self, p: &DiskPath) -> DiskResult<()> {
        match fs::symlink_metadata(p) {
            Ok(m) if m.is_dir() && !m.file_type().is_symlink() => Ok(()),
            Ok(_) => Err("Export path is a symlink or not a directory".into()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                fs::create_dir(p).map_err(|_| "Cannot create export folder")?;
                self.owned(p, 0o755)
            }
            Err(_) => Err("Cannot inspect export folder".into()),
        }
    }
    fn write(&self, p: &DiskPath, bytes: &[u8]) -> DiskResult<()> {
        let mut f = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .custom_flags(libc::O_NOFOLLOW)
            .mode(0o600)
            .open(p)
            .map_err(|_| "Export file already exists or is unsafe")?;
        f.write_all(bytes)
            .and_then(|_| f.sync_all())
            .map_err(|_| "Cannot write export file")?;
        self.owned(p, 0o644)
    }
    fn workspace(&self, key: &str, id: Uuid) -> DiskResult<PathBuf> {
        if key.is_empty()
            || key.starts_with('.')
            || key.contains('/')
            || key.contains('\\')
            || key.chars().any(|c| c.is_control())
        {
            return Err("Unsafe workspace directory".into());
        }
        self.dir(&self.root)?;
        let p = self.root.join(key);
        let exists = p.exists();
        self.dir(&p)?;
        let marker = p.join(".office-workspace.json");
        if marker.exists() {
            let value: Value = serde_json::from_slice(&read(&marker, 8192)?)
                .map_err(|_| "Invalid workspace ownership marker")?;
            if value["workspace_id"] != id.to_string() {
                return Err("Folder belongs to another workspace".into());
            }
        } else {
            if exists
                && fs::read_dir(&p)
                    .map_err(|_| "Cannot inspect existing workspace folder")?
                    .next()
                    .is_some()
            {
                return Err(
                    "Existing host folder is not owned by Office; no files were overwritten".into(),
                );
            }
            self.write(
                &marker,
                &serde_json::to_vec(&json!({"workspace_id":id,"directory_key":key})).unwrap(),
            )?;
        }
        Ok(p)
    }
    fn export(
        &self,
        wid: Uuid,
        key: &str,
        tid: Uuid,
        run: Uuid,
        files: &[(String, i64)],
    ) -> DiskResult<(String, Value)> {
        let ws = self.workspace(key, wid)?;
        let mut parent = ws;
        for component in ["tasks".to_string(), tid.to_string(), "runs".into()] {
            parent.push(component);
            self.dir(&parent)?;
        }
        let relative = format!("workspace/{key}/tasks/{tid}/runs/{run}");
        let target = parent.join(run.to_string());
        if let Ok(meta) = fs::symlink_metadata(&target) {
            if !meta.is_dir() || meta.file_type().is_symlink() {
                return Err("Existing export path is unsafe".into());
            }
            let marker: Value =
                serde_json::from_slice(&read(&target.join(".office-export.json"), 262144)?)
                    .map_err(|_| "Invalid export manifest")?;
            if marker["workspace_id"] != wid.to_string()
                || marker["task_id"] != tid.to_string()
                || marker["run_id"] != run.to_string()
            {
                return Err("Existing export belongs to another run".into());
            }
            let entries = marker["files"]
                .as_array()
                .ok_or("Missing export file manifest")?;
            let expected: Vec<_> = files.iter().filter(|(name, _)| safe(name)).collect();
            if entries.len() != expected.len() {
                return Err("Existing snapshot does not match registered files".into());
            }
            for (name, size) in expected {
                if *size < 0 || *size > 10 * 1024 * 1024 {
                    return Err("Invalid registered source size".into());
                }
                let entry = entries
                    .iter()
                    .find(|v| v["name"] == *name)
                    .ok_or("Missing exported file")?;
                let mut file = target.clone();
                for c in name.split('/') {
                    file.push(c);
                    if fs::symlink_metadata(&file)
                        .map_err(|_| "Existing export missing")?
                        .file_type()
                        .is_symlink()
                    {
                        return Err("Export symlink rejected".into());
                    }
                }
                let bytes = read(&file, *size as u64)?;
                if bytes.len() != *size as usize
                    || entry["sha256"] != format!("{:x}", Sha256::digest(&bytes))
                {
                    return Err(
                        "Exported file was edited; original copy will not be overwritten".into(),
                    );
                }
            }
            return Ok((relative, marker["files"].clone()));
        }
        let stage = parent.join(format!(".export-{}", Uuid::new_v4()));
        self.dir(&stage)?;
        let result = (|| {
            let source = DiskPath::new("/data/runs").join(run.to_string());
            if fs::symlink_metadata(&source)
                .map_err(|_| "Missing source run directory")?
                .file_type()
                .is_symlink()
            {
                return Err("Source run symlink rejected".into());
            }
            let mut manifest = Vec::new();
            let mut total = 0i64;
            for (name, size) in files {
                if !safe(name) {
                    continue;
                }
                total += size;
                if *size < 0
                    || *size > 10 * 1024 * 1024
                    || total > 50 * 1024 * 1024
                    || manifest.len() >= 100
                {
                    return Err("Export source exceeds budget".into());
                }
                let mut input = source.clone();
                for c in name.split('/') {
                    input.push(c);
                    if fs::symlink_metadata(&input)
                        .map_err(|_| "Source file missing")?
                        .file_type()
                        .is_symlink()
                    {
                        return Err("Source symlink rejected".into());
                    }
                }
                let bytes = read(&input, *size as u64)?;
                if bytes.len() != *size as usize {
                    return Err("Registered source size changed".into());
                }
                let mut out = stage.clone();
                let parts: Vec<_> = name.split('/').collect();
                for c in &parts[..parts.len() - 1] {
                    out.push(c);
                    self.dir(&out)?;
                }
                out.push(parts[parts.len() - 1]);
                self.write(&out, &bytes)?;
                manifest.push(json!({"name":name,"bytes":size,"sha256":format!("{:x}",Sha256::digest(&bytes))}));
            }
            self.write(
                &stage.join(".office-export.json"),
                &serde_json::to_vec_pretty(
                    &json!({"workspace_id":wid,"task_id":tid,"run_id":run,"files":manifest}),
                )
                .unwrap(),
            )?;
            fs::rename(&stage, &target).map_err(|_| "Cannot publish export snapshot")?;
            Ok((relative, json!(manifest)))
        })();
        if result.is_err() {
            let _ = fs::remove_dir_all(&stage);
        }
        result
    }
}
fn read(p: &DiskPath, max: u64) -> DiskResult<Vec<u8>> {
    let f = fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW)
        .open(p)
        .map_err(|_| "Cannot read source or ownership marker")?;
    if !f.metadata().map_err(|_| "Cannot inspect source")?.is_file() {
        return Err("Source is not a regular file".into());
    }
    let mut bytes = Vec::new();
    f.take(max + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "Cannot read export source")?;
    if bytes.len() as u64 > max {
        return Err("Source exceeds registered size or marker limit".into());
    }
    Ok(bytes)
}
pub(crate) async fn cycle(db: &PgPool) -> Result<()> {
    let disk = WorkspaceDirectory::new(PathBuf::from("/workspace"));
    let workspaces: Vec<(Uuid, String)> =
        sqlx::query_as("SELECT id,directory_key FROM workspaces WHERE deleted_at IS NULL")
            .fetch_all(db)
            .await?;
    for (wid, key) in workspaces {
        let error = disk.workspace(&key, wid).err().unwrap_or_default();
        sqlx::query("INSERT INTO workspace_directories(workspace_id,status,error) VALUES($1,$2,$3) ON CONFLICT(workspace_id) DO UPDATE SET status=EXCLUDED.status,error=EXCLUDED.error,updated_at=now()").bind(wid).bind(if error.is_empty(){"ready"}else{"failed"}).bind(error).execute(db).await?;
    }
    // Regenerate missing exported snapshots after moving/restoring the Office database.
    let ready:Vec<(Uuid,String)>=sqlx::query_as("SELECT e.run_id,e.relative_path FROM workspace_code_exports e JOIN workspaces w ON w.id=e.workspace_id WHERE e.status='ready' AND w.deleted_at IS NULL").fetch_all(db).await?;
    for (run, path) in ready {
        if let Some(relative) = path.strip_prefix("workspace/") {
            if phase2::safe_relative(relative)
                && fs::symlink_metadata(disk.root.join(relative))
                    .is_err_and(|e| e.kind() == std::io::ErrorKind::NotFound)
            {
                sqlx::query("UPDATE workspace_code_exports SET status='pending',updated_at=now()-interval '61 seconds' WHERE run_id=$1").bind(run).execute(db).await?;
            }
        }
    }
    let runs:Vec<(Uuid,Uuid,Uuid,String)>=sqlx::query_as("SELECT r.id,t.id,w.id,w.directory_key FROM task_runs r JOIN tasks t ON t.id=r.task_id JOIN workspaces w ON w.id=t.workspace_id WHERE r.status='review' AND r.finished_at IS NOT NULL AND t.deleted_at IS NULL AND w.deleted_at IS NULL AND t.review_for_task_id IS NULL AND EXISTS(SELECT 1 FROM artifacts a WHERE a.run_id=r.id) AND NOT EXISTS(SELECT 1 FROM workspace_code_exports e WHERE e.run_id=r.id AND (e.status='ready' OR e.updated_at>now()-interval '60 seconds')) ORDER BY r.finished_at LIMIT 8").fetch_all(db).await?;
    for (run, tid, wid, key) in runs {
        let files:Vec<(String,i64)>=sqlx::query_as("SELECT name,size FROM artifacts WHERE run_id=$1 AND task_id=$2 ORDER BY name LIMIT 101").bind(run).bind(tid).fetch_all(db).await?;
        let result = disk.export(wid, &key, tid, run, &files);
        let (path, status, error, manifest) = match result {
            Ok((p, m)) => (p, "ready", String::new(), m),
            Err(e) => (
                format!("workspace/{key}/tasks/{tid}/runs/{run}"),
                "failed",
                e,
                json!([]),
            ),
        };
        sqlx::query("INSERT INTO workspace_code_exports(run_id,workspace_id,task_id,relative_path,status,error,files,manifest) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(run_id) DO UPDATE SET relative_path=EXCLUDED.relative_path,status=EXCLUDED.status,error=EXCLUDED.error,files=EXCLUDED.files,manifest=EXCLUDED.manifest,updated_at=now()").bind(run).bind(wid).bind(tid).bind(path).bind(status).bind(error).bind(manifest.as_array().map_or(0,|v|v.len()) as i32).bind(manifest).execute(db).await?;
    }
    Ok(())
}
pub(crate) fn start(db: PgPool) {
    tokio::spawn(async move {
        loop {
            if cycle(&db).await.is_err() {
                eprintln!("Workspace export cycle failed");
            }
            tokio::time::sleep(std::time::Duration::from_secs(3)).await;
        }
    });
}
pub(crate) async fn run() -> Result<()> {
    let db =
        PgPool::connect(&std::env::var("DATABASE_URL").expect("DATABASE_URL required")).await?;
    loop {
        cycle(&db).await?;
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn unsafe_or_reference_files_are_not_exported() {
        for n in [
            "../a",
            "inputs/a.rs",
            "references/a.rs",
            ".env",
            "a/.git/config",
            "node_modules/a.js",
            "result.md",
        ] {
            assert!(!safe(n), "{n}")
        }
        assert!(safe("src/main.rs"));
        assert!(safe("package-lock.json"));
    }
    #[test]
    fn directory_ownership_and_symlinks_are_checked() {
        let root = std::env::temp_dir().join(format!("export-{}", Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        let disk = WorkspaceDirectory {
            root: root.clone(),
            uid: unsafe { libc::getuid() },
            gid: unsafe { libc::getgid() },
        };
        let id = Uuid::new_v4();
        assert!(disk.workspace("one", id).is_ok());
        assert!(disk.workspace("one", id).is_ok());
        assert!(disk.workspace("one", Uuid::new_v4()).is_err());
        assert!(disk.workspace("../bad", id).is_err());
        std::os::unix::fs::symlink(root.join("one"), root.join("two")).unwrap();
        assert!(disk.workspace("two", id).is_err());
        fs::remove_dir_all(root).unwrap();
    }
}
