use super::*;
use axum::extract::Query;
#[derive(Default, Deserialize)]
pub(crate) struct DetailQuery {
    #[serde(default)]
    pub compact: bool,
}
#[derive(Default, Deserialize)]
struct LogQuery {
    before: Option<usize>,
    limit: Option<usize>,
}
#[derive(Default, Deserialize)]
struct EventQuery {
    before: Option<i64>,
}
pub(crate) fn routes() -> Router<App> {
    Router::new()
        .route("/workspaces/{wid}/tasks/{id}/history-events", get(events))
        .route("/workspaces/{wid}/tasks/{id}/runs/{run}/log", get(log))
}
async fn events(
    State(a): State<App>,
    h: HeaderMap,
    Path((wid, id)): Path<(Uuid, Uuid)>,
    Query(q): Query<EventQuery>,
) -> Result<Json<Value>> {
    let u = user(&a, &h).await?;
    access(&a, &u, wid, false).await?;
    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM tasks WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL)",
    )
    .bind(id)
    .bind(wid)
    .fetch_one(&a.db)
    .await?;
    if !exists {
        return Err(Error(StatusCode::NOT_FOUND, "Task not found"));
    }
    let rows:Vec<Value>=sqlx::query_scalar("SELECT to_jsonb(e) FROM task_events e WHERE task_id=$1 AND ($2::bigint IS NULL OR id<$2) ORDER BY id DESC LIMIT 21").bind(id).bind(q.before).fetch_all(&a.db).await?;
    let more = rows.len() > 20;
    let rows = rows.into_iter().take(20).collect::<Vec<_>>();
    let next = if more {
        rows.last().and_then(|e| e["id"].as_i64())
    } else {
        None
    };
    Ok(Json(json!({"events":rows,"next_before":next})))
}
fn window(text: &str, before: Option<usize>, limit: usize) -> (usize, usize) {
    let mut end = before.unwrap_or(text.len()).min(text.len());
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    let mut start = end.saturating_sub(limit);
    while !text.is_char_boundary(start) {
        start += 1;
    }
    (start, end)
}
async fn log(
    State(a): State<App>,
    h: HeaderMap,
    Path((wid, id, run)): Path<(Uuid, Uuid, Uuid)>,
    Query(q): Query<LogQuery>,
) -> Result<Json<Value>> {
    let u = user(&a, &h).await?;
    access(&a, &u, wid, false).await?;
    let text:Option<String>=sqlx::query_scalar("SELECT CASE WHEN r.result<>'' THEN r.result ELSE r.error END FROM task_runs r JOIN tasks t ON t.id=r.task_id WHERE r.id=$1 AND t.id=$2 AND t.workspace_id=$3 AND t.deleted_at IS NULL").bind(run).bind(id).bind(wid).fetch_optional(&a.db).await?;
    let text = text.ok_or(Error(StatusCode::NOT_FOUND, "Run not found"))?;
    let limit = q.limit.unwrap_or(20000).clamp(1024, 50000);
    let (start, end) = window(&text, q.before, limit);
    Ok(Json(
        json!({"content":&text[start..end],"start":start,"end":end,"total_bytes":text.len(),"next_before":if start>0{Some(start)}else{None}}),
    ))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn windows_preserve_unicode_without_overlap_or_loss() {
        let s = "กA🙂".repeat(1000);
        let mut before = None;
        let mut reconstructed = String::new();
        loop {
            let (start, end) = window(&s, before, 1024);
            assert!(end - start <= 1024);
            reconstructed = format!("{}{}", &s[start..end], reconstructed);
            if start == 0 {
                break;
            }
            before = Some(start);
        }
        assert_eq!(s, reconstructed);
        assert_eq!(window("abc", Some(999), 100), (0, 3));
    }
}
