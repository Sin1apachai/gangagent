//! Read-only inventory; accepted tasks are not proof of a runnable release.
use super::*;
pub(crate) fn routes() -> Router<App> {
    Router::new().route(
        "/workspaces/{wid}/plans/{id}/delivery-evidence",
        get(inspect),
    )
}
async fn inspect(
    State(a): State<App>,
    h: HeaderMap,
    Path((wid, id)): Path<(Uuid, Uuid)>,
) -> Result<Json<Value>> {
    let u = user(&a, &h).await?;
    access(&a, &u, wid, false).await?;
    let exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM plans WHERE id=$1 AND workspace_id=$2)")
            .bind(id)
            .bind(wid)
            .fetch_one(&a.db)
            .await?;
    if !exists {
        return Err(Error(StatusCode::NOT_FOUND, "Plan not found"));
    }
    let files:Vec<(Uuid,String,i64)>=sqlx::query_as("SELECT a.run_id,a.name,a.size FROM tasks t JOIN artifacts a ON a.task_id=t.id AND a.run_id=t.current_run_id WHERE t.plan_id=$1 AND t.workspace_id=$2 AND t.deleted_at IS NULL AND t.review_for_task_id IS NULL AND a.name NOT LIKE 'inputs/%' AND a.name NOT LIKE 'references/%' AND a.name<>'result.md' ORDER BY a.name").bind(id).bind(wid).fetch_all(&a.db).await?;
    let code = files.iter().filter(|(_, n, _)| is_code(n)).count();
    let mut placeholders = 0;
    for (run, name, size) in &files {
        if !matches!(
            name.as_str(),
            "compose.yaml" | "compose.yml" | "docker-compose.yml" | "docker-compose.yaml"
        ) || *size > 65536
            || !phase2::safe_relative(name)
        {
            continue;
        }
        let root = std::path::Path::new("/data/runs").join(run.to_string());
        if let (Ok(base), Ok(path)) = (
            tokio::fs::canonicalize(&root).await,
            tokio::fs::canonicalize(root.join(name)).await,
        ) {
            if path.starts_with(base) {
                if let Ok(s) = tokio::fs::read_to_string(path).await {
                    if s.lines().any(|l| {
                        l.trim() == "services: {}" || l.trim() == "services: {} # placeholder"
                    }) {
                        placeholders += 1;
                    }
                }
            }
        }
    }
    let required:i64=sqlx::query_scalar("SELECT count(*) FROM tasks WHERE plan_id=$1 AND workspace_id=$2 AND runtime_enabled AND review_for_task_id IS NULL AND deleted_at IS NULL").bind(id).bind(wid).fetch_one(&a.db).await?;
    let verified:i64=sqlx::query_scalar("SELECT count(*) FROM tasks t WHERE t.plan_id=$1 AND t.workspace_id=$2 AND t.runtime_enabled AND t.review_for_task_id IS NULL AND t.deleted_at IS NULL AND EXISTS(SELECT 1 FROM runtime_jobs r WHERE r.task_id=t.id AND r.source_run_id=t.current_run_id AND r.status IN('ready','stopped') AND r.evidence->>'tests_passed'='true' AND r.evidence->>'http_passed'='true')").bind(id).bind(wid).fetch_one(&a.db).await?;
    Ok(Json(
        json!({"code_files":code,"deliverable_files":files.len(),"empty_compose_files":placeholders,"runtime_verified":required>0&&verified==required,"runtime_required":required,"runtime_verified_count":verified,"assessment":if required>0&&verified==required{"runtime_verified"}else if files.is_empty(){"no_deliverables"}else if code==0{"documents_only"}else{"runtime_not_verified"},"message":if required>0&&verified==required{"Runner ตรวจ Build / Test / HTTP ผ่านสำหรับงานที่กำหนดแล้ว"}else if placeholders>0{"พบ Compose ที่ยังไม่มีบริการ จึงยังเปิดโปรแกรมจากไฟล์นี้ไม่ได้"}else if code==0&&!files.is_empty(){"พบเอกสาร แต่ยังไม่พบไฟล์โค้ดโปรแกรมในชุดส่งมอบ"}else{"ต้องตรวจหลักฐาน build และทดสอบจริงก่อนยืนยันว่ารันได้"}}),
    ))
}
fn is_code(name: &str) -> bool {
    matches!(
        name.rsplit('.').next(),
        Some(
            "rs" | "mjs"
                | "cjs"
                | "tsx"
                | "ts"
                | "js"
                | "jsx"
                | "py"
                | "go"
                | "java"
                | "kt"
                | "cs"
                | "html"
                | "vue"
                | "svelte"
                | "php"
                | "rb"
                | "swift"
                | "cpp"
                | "c"
        )
    )
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn documents_are_not_source_evidence() {
        assert!(!is_code("README.md"));
        assert!(!is_code("compose.yaml"));
        assert!(is_code("server/src/main.rs"));
        assert!(is_code("src/App.tsx"));
    }
}
