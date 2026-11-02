use super::*;
#[path = "project_tree.rs"]
mod project_tree;
pub(crate) use project_tree::prepare;
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::{
    fs,
    io::{Read, Write},
    path::{Path as DiskPath, PathBuf},
};
const STANDARD: &str = include_str!("../standards/workspace-code-v1.md");
type DiskResult<T> = std::result::Result<T, String>;
pub(crate) fn standard() -> Value {
    json!({"id":"workspace-project-code","version":1,"title":"โฟลเดอร์โค้ดแยกตาม Workspace","instructions":STANDARD,"checksum":digest(STANDARD)})
}
pub(crate) fn prompt(context: Option<&Value>) -> String {
    if context
        .and_then(|c| c["standards"].as_array())
        .is_some_and(|a| a.iter().any(|s| s["id"] == "workspace-project-code"))
    {
        String::new()
    } else {
        format!("\n{STANDARD}\n")
    }
}
pub(crate) async fn import(db: &PgPool) -> Result<()> {
    sqlx::query("INSERT INTO system_standards(id,version,title,instructions,checksum) VALUES('workspace-project-code',1,$1,$2,$3) ON CONFLICT(id,version) DO UPDATE SET instructions=EXCLUDED.instructions,checksum=EXCLUDED.checksum").bind(standard()["title"].as_str()).bind(STANDARD).bind(digest(STANDARD)).execute(db).await?;
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
    let project:Option<String>=sqlx::query_scalar("SELECT p.code_directory_key FROM tasks t JOIN projects p ON p.id=t.project_id AND p.workspace_id=t.workspace_id WHERE t.id=$1").bind(tid).fetch_optional(&a.db).await?;
    let path = format!(
        "workspace/{}/{}",
        key,
        project.unwrap_or_else(|| "app".into())
    );
    let session:Option<Value>=sqlx::query_scalar("SELECT to_jsonb(s)-'base' FROM project_code_sessions s JOIN tasks t ON t.current_run_id=s.run_id WHERE t.id=$1 AND s.workspace_id=$2").bind(tid).bind(wid).fetch_optional(&a.db).await?;
    let session = if session.is_some() {
        session
    } else {
        sqlx::query_scalar("SELECT CASE WHEN usage_metrics->>'project_code_state'='unavailable' THEN jsonb_build_object('state','unavailable','error',usage_metrics->>'project_code_error') ELSE NULL END FROM task_runs r JOIN tasks t ON t.current_run_id=r.id WHERE t.id=$1").bind(tid).fetch_optional(&a.db).await?.flatten()
    };
    Ok(Json(
        json!({"root":format!("workspace/{key}"),"path":path,"session":session,"mode":"project-working-tree"}),
    ))
}

fn safe(name: &str) -> bool {
    phase2::safe_relative(name)
        && !name
            .chars()
            .any(|c| c.is_control() || c == '\\' || c == ':')
        && !name.split('/').any(|p| {
            p.starts_with(".office-")
                || matches!(
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
                )
                || (p.starts_with(".env") && p != ".env.example")
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
    project_tree::cycle(db).await
}
pub(crate) fn start(db: PgPool) {
    tokio::spawn(async move {
        loop {
            if cycle(&db).await.is_err() {
                eprintln!("Workspace export cycle failed");
            }
            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
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
