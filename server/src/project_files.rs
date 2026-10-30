//! Local native picker bridge. AI receives a bounded disposable copy, never bridge credentials.
use super::*;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpStream,
};
pub(crate) async fn request(route: &str, body: &Value) -> Result<Value> {
    let token = std::env::var("PROJECT_BRIDGE_TOKEN").unwrap_or_default();
    if token.len() < 24 {
        return Err(bad("Connect the local folder picker first"));
    }
    let addr = std::env::var("PROJECT_BRIDGE_ADDR").unwrap_or("host.docker.internal:18089".into());
    let operation = async {
        let bytes = serde_json::to_vec(body).map_err(|_| bad("Invalid folder request"))?;
        let mut stream = TcpStream::connect(addr)
            .await
            .map_err(|_| bad("Local folder picker is offline; start it on the worker computer"))?;
        let header=format!("POST {route} HTTP/1.0\r\nHost: local-folder-bridge\r\nAuthorization: Bearer {token}\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n",bytes.len());
        stream
            .write_all(header.as_bytes())
            .await
            .map_err(|_| bad("Local folder connection failed"))?;
        stream
            .write_all(&bytes)
            .await
            .map_err(|_| bad("Local folder connection failed"))?;
        let mut response = vec![];
        stream
            .take(4 * 1024 * 1024 + 1)
            .read_to_end(&mut response)
            .await
            .map_err(|_| bad("Local folder connection failed"))?;
        if response.len() > 4 * 1024 * 1024 {
            return Err(bad("Project folder response exceeds limit"));
        }
        let split = response
            .windows(4)
            .position(|b| b == b"\r\n\r\n")
            .ok_or(bad("Invalid folder bridge response"))?;
        if !response.starts_with(b"HTTP/1.0 200 ") {
            return Err(bad("Folder operation cancelled, unavailable or conflicted; re-select the folder or review task output"));
        }
        serde_json::from_slice(&response[split + 4..])
            .map_err(|_| bad("Invalid folder bridge data"))
    };
    tokio::time::timeout(std::time::Duration::from_secs(130), operation)
        .await
        .map_err(|_| bad("Folder selection timed out"))?
}
pub(crate) fn routes() -> Router<App> {
    Router::new().route("/workspaces/{wid}/project-folders/pick", post(pick))
}
async fn pick(State(a): State<App>, h: HeaderMap, Path(wid): Path<Uuid>) -> Result<Json<Value>> {
    let u = user(&a, &h).await?;
    access(&a, &u, wid, true).await?;
    Ok(Json(request("/pick", &json!({"owner":u.id})).await?))
}
pub(crate) async fn validate(owner: Uuid, folder: Option<&Value>) -> Result<Option<Value>> {
    let Some(f) = folder else { return Ok(None) };
    if f.as_object().is_some_and(|o| o.is_empty()) {
        return Ok(None);
    }
    if f.get("id").is_none() {
        return Err(bad("Choose the folder using the native picker"));
    }
    request(
        "/validate",
        &json!({"id":f["id"],"bridge_id":f["bridge_id"],"owner":owner}),
    )
    .await
    .map(Some)
}
pub(crate) async fn freeze(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    wid: Uuid,
    tid: Uuid,
    owner: Uuid,
    context: &mut Value,
) -> Result<()> {
    let folder:Option<Value>=sqlx::query_scalar("SELECT p.working_folder FROM tasks t JOIN projects p ON p.id=t.project_id AND p.workspace_id=t.workspace_id WHERE t.id=$1 AND t.workspace_id=$2 AND p.deleted_at IS NULL AND p.working_folder IS NOT NULL").bind(tid).bind(wid).fetch_optional(&mut **tx).await?;
    if let Some(f) = folder {
        let mut f = validate(owner, Some(&f))
            .await?
            .ok_or(bad("Project folder unavailable"))?;
        f["owner"] = json!(owner);
        context["project_folder"] = f;
    }
    Ok(())
}
pub(crate) struct Snapshot {
    binding: Value,
    id: Value,
    before: std::collections::BTreeMap<String, String>,
}
impl Snapshot {
    pub(crate) async fn prepare(
        context: Option<&Value>,
        dir: &std::path::Path,
    ) -> Result<Option<Self>> {
        let Some(binding) = context.and_then(|c| c.get("project_folder")) else {
            return Ok(None);
        };
        let exported = request("/snapshot", binding).await?;
        let files = exported["files"]
            .as_array()
            .ok_or(bad("Invalid project snapshot"))?;
        let mut before = std::collections::BTreeMap::new();
        let mut total = 0;
        for f in files {
            let path = f["path"].as_str().ok_or(bad("Invalid snapshot file"))?;
            let content = f["content"]
                .as_str()
                .ok_or(bad("Invalid snapshot content"))?;
            if !safe(path) || content.len() > 256 * 1024 || before.len() >= 200 {
                return Err(bad("Invalid project snapshot"));
            }
            total += content.len();
            if total > 2 * 1024 * 1024 {
                return Err(bad("Project snapshot exceeds limit"));
            }
            before.insert(path.to_string(), content.to_string());
        }
        crate::worker::prepare_project_dir(dir)
            .map_err(|_| bad("Cannot prepare project folder"))?;
        // Reuse the validated declarative writer, in batches respecting its output budget.
        for (path, content) in &before {
            let raw=json!({"summary":"","files":[{"path":format!("project/{path}"),"content":content}]}).to_string();
            crate::worker::write_project_snapshot(dir, &raw)
                .map_err(|_| bad("Cannot prepare project file"))?;
        }
        std::fs::create_dir_all(dir.join("project"))
            .map_err(|_| bad("Cannot prepare project folder"))?;
        Ok(Some(Self {
            binding: binding.clone(),
            id: exported["snapshot_id"].clone(),
            before,
        }))
    }
    pub(crate) async fn publish(&self, dir: &std::path::Path) -> Result<usize> {
        let mut files = vec![];
        let mut total = 0;
        collect(&dir.join("project"), "", &mut files, &mut total, 0)
            .map_err(|_| bad("Unsafe project output"))?;
        let changed = files
            .into_iter()
            .filter(|f| {
                self.before
                    .get(f["path"].as_str().unwrap())
                    .map(String::as_str)
                    != f["content"].as_str()
            })
            .collect::<Vec<_>>();
        let mut b = self.binding.clone();
        b["snapshot_id"] = self.id.clone();
        b["files"] = json!(changed);
        let result = request("/publish", &b).await?;
        Ok(result["saved"].as_u64().unwrap_or(0) as usize)
    }
}
fn safe(path: &str) -> bool {
    crate::phase2::safe_relative(path)
        && path.len() <= 240
        && path
            .split('/')
            .all(|s| !s.starts_with('.') && !s.contains('\\') && !s.chars().any(char::is_control))
}
fn collect(
    dir: &std::path::Path,
    prefix: &str,
    out: &mut Vec<Value>,
    total: &mut usize,
    depth: usize,
) -> std::io::Result<()> {
    if depth > 8 || std::fs::symlink_metadata(dir)?.file_type().is_symlink() {
        return Err(std::io::Error::other("Unsafe project directory"));
    }
    for e in std::fs::read_dir(dir)? {
        let e = e?;
        let name = e.file_name().to_string_lossy().to_string();
        let path = format!("{prefix}{name}");
        let m = e.path().symlink_metadata()?;
        if !safe(&path) || m.file_type().is_symlink() {
            return Err(std::io::Error::other("Unsafe project output"));
        }
        if m.is_dir() {
            collect(&e.path(), &format!("{path}/"), out, total, depth + 1)?;
        } else if m.is_file() {
            if m.len() > 256 * 1024 || out.len() >= 200 {
                return Err(std::io::Error::other("Project output limit"));
            }
            let content = std::fs::read_to_string(e.path())?;
            *total += content.len();
            if *total > 2 * 1024 * 1024 {
                return Err(std::io::Error::other("Project output limit"));
            }
            out.push(json!({"path":path,"content":content}));
        }
    }
    Ok(())
}
