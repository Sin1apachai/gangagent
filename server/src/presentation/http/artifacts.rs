use super::*;
pub(crate) fn safe_relative(name: &str) -> bool {
    let p = FsPath::new(name);
    !name.is_empty()
        && !p.is_absolute()
        && p.components().all(|c| matches!(c, Component::Normal(_)))
}
#[derive(Deserialize, Default)]
pub(crate) struct ArtifactOptions {
    #[serde(default)]
    preview: bool,
}
pub(crate) async fn artifact(
    State(a): State<App>,
    h: HeaderMap,
    Path((wid, id, aid)): Path<(Uuid, Uuid, Uuid)>,
    axum::extract::Query(options): axum::extract::Query<ArtifactOptions>,
) -> Result<Response> {
    let u = user(&a, &h).await?;
    access(&a, &u, wid, false).await?;
    let row:Option<(Uuid,String)>=sqlx::query_as("SELECT a.run_id,a.name FROM artifacts a JOIN tasks t ON t.id=a.task_id WHERE a.id=$1 AND task_id=$2 AND t.workspace_id=$3 AND t.deleted_at IS NULL").bind(aid).bind(id).bind(wid).fetch_optional(&a.db).await?;
    let (run, name) = row.ok_or(Error(StatusCode::NOT_FOUND, "Artifact not found"))?;
    if !safe_relative(&name) {
        return Err(bad("Invalid artifact path"));
    }
    let root = FsPath::new("/data/runs").join(run.to_string());
    let root = tokio::fs::canonicalize(&root)
        .await
        .map_err(|_| Error(StatusCode::NOT_FOUND, "Artifact unavailable"))?;
    let path = tokio::fs::canonicalize(root.join(&name))
        .await
        .map_err(|_| Error(StatusCode::NOT_FOUND, "Artifact unavailable"))?;
    if !path.starts_with(&root) {
        return Err(Error(StatusCode::FORBIDDEN, "Artifact path denied"));
    }
    let meta = tokio::fs::metadata(&path)
        .await
        .map_err(|_| bad("Artifact unavailable"))?;
    if !meta.is_file() || meta.len() > 10 * 1024 * 1024 {
        return Err(bad("Artifact exceeds download size limit"));
    }
    let bytes = tokio::fs::read(&path)
        .await
        .map_err(|_| bad("Artifact unavailable"))?;
    if options.preview {
        let extension = name.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
        if extension == "pdf" {
            return Err(bad(
                "PDF preview is unavailable; download the original file",
            ));
        }
        let mime = match extension.as_str() {
            "png" => Some("image/png"),
            "jpg" | "jpeg" => Some("image/jpeg"),
            "gif" => Some("image/gif"),
            "webp" => Some("image/webp"),
            _ => None,
        };
        if let Some(mime) = mime {
            return Response::builder()
                .header(header::CONTENT_TYPE, mime)
                .header(header::CONTENT_DISPOSITION, "inline")
                .header("content-security-policy", "default-src 'none'; sandbox")
                .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
                .body(Body::from(bytes))
                .map_err(|_| bad("Invalid preview response"));
        }
        if bytes.len() > 512 * 1024 || bytes.contains(&0) {
            return Err(bad(
                "Preview unavailable for this binary or large file; download it instead",
            ));
        }
        let text = String::from_utf8(bytes).map_err(|_| {
            bad("Preview supports UTF-8 text and images; download this file instead")
        })?;
        return Ok(Json(json!({"kind":"text","name":name,"content":text})).into_response());
    }
    let encoded = name
        .rsplit('/')
        .next()
        .unwrap_or("artifact.bin")
        .as_bytes()
        .iter()
        .map(|b| format!("%{b:02X}"))
        .collect::<String>();
    Response::builder()
        .header(header::CONTENT_TYPE, "application/octet-stream")
        .header(
            header::CONTENT_DISPOSITION,
            format!("attachment; filename*=UTF-8''{encoded}"),
        )
        .body(Body::from(bytes))
        .map_err(|_| bad("Invalid artifact response"))
}
