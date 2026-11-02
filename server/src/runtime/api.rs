use super::*;
use axum::extract::Query;
use sqlx::{Postgres, Transaction};
pub(crate) fn routes() -> Router<App> {
    Router::new()
        .route("/standards", get(standards_list))
        .route(
            "/workspaces/{wid}/tasks/{id}/runtime",
            get(list).post(launch),
        )
        .route("/workspaces/{wid}/runtime/{id}/stop", post(stop))
        .route("/workspaces/{wid}/runtime/{id}/logs", get(logs))
}
async fn standards_list(State(a): State<App>, h: HeaderMap) -> Result<Json<Value>> {
    user(&a, &h).await?;
    let rows: Vec<Value> =
        sqlx::query_scalar("SELECT to_jsonb(s) FROM system_standards s ORDER BY id,version")
            .fetch_all(&a.db)
            .await?;
    Ok(Json(json!(rows)))
}
#[derive(Deserialize)]
struct Launch {
    acknowledged: bool,
}
pub(crate) async fn enqueue(
    tx: &mut Transaction<'_, Postgres>,
    wid: Uuid,
    id: Uuid,
    uid: Uuid,
) -> Result<Uuid> {
    let source:Option<(Uuid,Uuid)>=sqlx::query_as("SELECT current_run_id,created_by FROM tasks WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL AND review_for_task_id IS NULL AND status IN('review','done') AND current_run_id IS NOT NULL FOR UPDATE").bind(id).bind(wid).fetch_optional(&mut **tx).await?;
    let (run, owner) = source.ok_or(bad("Runner requires a completed source run"))?;
    let old:Option<Uuid>=sqlx::query_scalar("SELECT id FROM runtime_jobs WHERE task_id=$1 AND source_run_id=$2 AND status IN('queued','building','testing','starting','ready','stopping')").bind(id).bind(run).fetch_optional(&mut **tx).await?;
    if let Some(id) = old {
        return Ok(id);
    }
    sqlx::query("SELECT pg_advisory_xact_lock(420025)")
        .execute(&mut **tx)
        .await?;
    let count:i64=sqlx::query_scalar("SELECT count(*) FROM runtime_jobs WHERE status IN('queued','building','testing','starting','ready','stopping') AND created_by=$1").bind(owner).fetch_one(&mut **tx).await?;
    let total:i64=sqlx::query_scalar("SELECT count(*) FROM runtime_jobs WHERE status IN('queued','building','testing','starting','ready','stopping')").fetch_one(&mut **tx).await?;
    if count >= 3 || total >= 6 {
        return Err(Error(
            StatusCode::CONFLICT,
            "Preview capacity reached; stop an existing preview first",
        ));
    }
    let mut port = None;
    for _ in 0..100 {
        let p: i64 = sqlx::query_scalar("SELECT 19000+(nextval('runtime_port_sequence')-1)%100")
            .fetch_one(&mut **tx)
            .await?;
        let used:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM runtime_jobs WHERE port=$1 AND status IN('queued','building','testing','starting','ready','stopping'))").bind(p as i32).fetch_one(&mut **tx).await?;
        if !used {
            port = Some(p as i32);
            break;
        }
    }
    let port = port.ok_or(Error(StatusCode::CONFLICT, "No preview port available"))?;
    let job = Uuid::new_v4();
    sqlx::query("INSERT INTO runtime_jobs(id,workspace_id,task_id,source_run_id,created_by,port) VALUES($1,$2,$3,$4,$5,$6)").bind(job).bind(wid).bind(id).bind(run).bind(owner).bind(port).execute(&mut **tx).await?;
    sqlx::query("INSERT INTO audit_events(user_id,workspace_id,action) VALUES($1,$2,$3)")
        .bind(uid)
        .bind(wid)
        .bind(format!("runtime.requested:{job}"))
        .execute(&mut **tx)
        .await?;
    Ok(job)
}
async fn launch(
    State(a): State<App>,
    h: HeaderMap,
    Path((wid, id)): Path<(Uuid, Uuid)>,
    Json(b): Json<Launch>,
) -> Result<Json<Value>> {
    let u = user(&a, &h).await?;
    access(&a, &u, wid, true).await?;
    if !b.acknowledged {
        return Err(bad(
            "Confirm running project code in the managed Docker Runner",
        ));
    }
    let mut tx = a.db.begin().await?;
    organization::lock_workspace(&mut tx, wid).await?;
    let job = enqueue(&mut tx, wid, id, u.id).await?;
    sqlx::query("UPDATE tasks SET runtime_enabled=true,version=version+1 WHERE id=$1 AND NOT runtime_enabled").bind(id).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(Json(json!({"id":job})))
}
async fn list(
    State(a): State<App>,
    h: HeaderMap,
    Path((wid, id)): Path<(Uuid, Uuid)>,
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
    let jobs:Vec<Value>=sqlx::query_scalar("SELECT to_jsonb(r)-'log' FROM runtime_jobs r WHERE task_id=$1 AND workspace_id=$2 ORDER BY created_at DESC LIMIT 20").bind(id).bind(wid).fetch_all(&a.db).await?;
    let online:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM runtime_runner WHERE heartbeat_at>now()-interval '45 seconds' AND message='ready')").fetch_one(&a.db).await?;
    Ok(Json(
        json!({"online":online,"jobs":jobs,"standard":{"id":"application-runtime","version":1}}),
    ))
}
async fn stop(
    State(a): State<App>,
    h: HeaderMap,
    Path((wid, id)): Path<(Uuid, Uuid)>,
) -> Result<Json<Value>> {
    let u = user(&a, &h).await?;
    access(&a, &u, wid, true).await?;
    let n=sqlx::query("UPDATE runtime_jobs SET stop_requested=(status<>'queued'),status=CASE WHEN status='queued' THEN 'stopped' ELSE 'stopping' END,updated_at=now() WHERE id=$1 AND workspace_id=$2 AND status NOT IN('stopped')").bind(id).bind(wid).execute(&a.db).await?.rows_affected();
    if n == 0 {
        return Err(Error(
            StatusCode::NOT_FOUND,
            "Runtime job not found or already stopped",
        ));
    }
    phase2::audit(&a, &u, Some(wid), "runtime.stop_requested").await?;
    Ok(Json(json!({"ok":true})))
}
#[derive(Deserialize)]
struct LogQuery {
    before: Option<usize>,
}
async fn logs(
    State(a): State<App>,
    h: HeaderMap,
    Path((wid, id)): Path<(Uuid, Uuid)>,
    Query(q): Query<LogQuery>,
) -> Result<Json<Value>> {
    let u = user(&a, &h).await?;
    access(&a, &u, wid, false).await?;
    let log: Option<String> =
        sqlx::query_scalar("SELECT log FROM runtime_jobs WHERE id=$1 AND workspace_id=$2")
            .bind(id)
            .bind(wid)
            .fetch_optional(&a.db)
            .await?;
    let log = log.ok_or(Error(StatusCode::NOT_FOUND, "Runtime job not found"))?;
    let (start, end) = crate::task_logs::window(&log, q.before, 20000);
    Ok(Json(
        json!({"content":&log[start..end],"next_before":if start>0{Some(start)}else{None},"total_bytes":log.len()}),
    ))
}
pub(crate) async fn tick(a: &App) -> Result<()> {
    if sqlx::query_scalar::<_, bool>("SELECT office_worker_paused()")
        .fetch_one(&a.db)
        .await?
    {
        return Ok(());
    }
    let ids:Vec<(Uuid,Uuid,Uuid)>=sqlx::query_as("SELECT t.workspace_id,t.id,t.created_by FROM tasks t JOIN workspaces w ON w.id=t.workspace_id WHERE t.runtime_enabled AND t.status IN('review','done') AND t.review_for_task_id IS NULL AND t.deleted_at IS NULL AND w.deleted_at IS NULL AND t.current_run_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM runtime_jobs r WHERE r.task_id=t.id AND r.source_run_id=t.current_run_id) LIMIT 8").fetch_all(&a.db).await?;
    for (wid, id, uid) in ids {
        let mut tx = a.db.begin().await?;
        organization::lock_workspace(&mut tx, wid).await?;
        match enqueue(&mut tx, wid, id, uid).await {
            Ok(_) => tx.commit().await?,
            Err(_) => {
                tx.rollback().await?;
            }
        }
    }
    Ok(())
}
