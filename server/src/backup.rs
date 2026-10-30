use super::*;
use axum::body::Body;
use futures_util::stream;
use std::path::PathBuf;
use tokio::io::AsyncReadExt;
#[path = "backup_service.rs"]
mod service;
pub(crate) use service::run as run_worker;
pub(crate) const LOCK: i64 = 448721904;
pub(crate) fn root() -> PathBuf {
    PathBuf::from(std::env::var("BACKUP_DIR").unwrap_or("/backups".into()))
}
async fn admin(a: &App, h: &HeaderMap) -> Result<User> {
    let u = user(a, h).await?;
    if !u.is_super_admin {
        return Err(Error(StatusCode::FORBIDDEN, "Super admin required"));
    }
    Ok(u)
}
pub(crate) fn routes() -> Router<App> {
    Router::new()
        .route("/admin/backups", get(list).post(create))
        .route("/admin/backups/recover", post(recover))
        .route("/admin/backups/{id}", axum::routing::delete(remove))
        .route("/admin/backups/{id}/cancel", post(cancel))
        .route("/admin/backups/{id}/download", get(download))
}
async fn list(State(a): State<App>, h: HeaderMap) -> Result<Json<Value>> {
    admin(&a, &h).await?;
    let jobs:Vec<Value>=sqlx::query_scalar("SELECT to_jsonb(b) FROM backup_jobs b WHERE status='ready' OR id IN (SELECT id FROM backup_jobs WHERE status NOT IN ('ready','deleted') ORDER BY created_at DESC LIMIT 100) ORDER BY created_at DESC").fetch_all(&a.db).await?;
    let online:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM backup_service WHERE id AND heartbeat_at>now()-interval '15 seconds')").fetch_one(&a.db).await?;
    let paused: bool = sqlx::query_scalar("SELECT paused FROM office_maintenance WHERE id")
        .fetch_one(&a.db)
        .await?;
    Ok(Json(
        json!({"jobs":jobs,"online":online,"paused":paused,"max_files":20}),
    ))
}
#[derive(Deserialize)]
struct Acknowledgement {
    acknowledged: bool,
}
async fn create(
    State(a): State<App>,
    h: HeaderMap,
    Json(b): Json<Acknowledgement>,
) -> Result<Json<Value>> {
    let u = admin(&a, &h).await?;
    if !b.acknowledged {
        return Err(bad(
            "Confirm this backup contains all workspaces and account data",
        ));
    }
    let online:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM backup_service WHERE id AND heartbeat_at>now()-interval '15 seconds')").fetch_one(&a.db).await?;
    if !online {
        return Err(Error(
            StatusCode::SERVICE_UNAVAILABLE,
            "Backup service is offline",
        ));
    }
    let mut tx = a.db.begin().await?;
    sqlx::query("SELECT pg_advisory_xact_lock(448721905)")
        .execute(&mut *tx)
        .await?;
    let busy:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM backup_jobs WHERE status IN ('queued','waiting','snapshotting','archiving'))").fetch_one(&mut *tx).await?;
    if busy {
        return Err(Error(
            StatusCode::CONFLICT,
            "A backup is already in progress",
        ));
    }
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM backup_jobs WHERE status='ready'")
        .fetch_one(&mut *tx)
        .await?;
    if count >= 20 {
        return Err(bad("Delete an older backup first (maximum 20 files)"));
    }
    let id = Uuid::new_v4();
    sqlx::query("INSERT INTO backup_jobs(id,created_by,status) VALUES($1,$2,'queued')")
        .bind(id)
        .bind(u.id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    phase2::audit(&a, &u, None, "backup.requested").await?;
    Ok(Json(json!({"id":id})))
}
async fn cancel(State(a): State<App>, h: HeaderMap, Path(id): Path<Uuid>) -> Result<Json<Value>> {
    let u = admin(&a, &h).await?;
    let n=sqlx::query("UPDATE backup_jobs SET cancel_requested=true,status=CASE WHEN status='queued' THEN 'cancelled' ELSE status END,message='Cancellation requested',finished_at=CASE WHEN status='queued' THEN now() ELSE finished_at END WHERE id=$1 AND status IN ('queued','waiting','snapshotting','archiving')").bind(id).execute(&a.db).await?.rows_affected();
    if n > 0 {
        phase2::audit(&a, &u, None, "backup.cancelled").await?;
    }
    phase2::changed(n)
}
async fn remove(State(a): State<App>, h: HeaderMap, Path(id): Path<Uuid>) -> Result<Json<Value>> {
    let u = admin(&a, &h).await?;
    let n=sqlx::query("UPDATE backup_jobs SET status='deleting',message='Deleting stored file' WHERE id=$1 AND status IN ('ready','failed','cancelled')").bind(id).execute(&a.db).await?.rows_affected();
    if n > 0 {
        phase2::audit(&a, &u, None, "backup.delete_requested").await?;
    }
    phase2::changed(n)
}
async fn recover(State(a): State<App>, h: HeaderMap) -> Result<Json<Value>> {
    let u = admin(&a, &h).await?;
    let mut conn = a.db.acquire().await?;
    let locked: bool = sqlx::query_scalar("SELECT pg_try_advisory_lock($1)")
        .bind(LOCK)
        .fetch_one(&mut *conn)
        .await?;
    if !locked {
        return Err(Error(
            StatusCode::CONFLICT,
            "Backup service is still active; cancel the job instead",
        ));
    }
    let result = service::recover(&a.db).await;
    let _ = sqlx::query("SELECT pg_advisory_unlock($1)")
        .bind(LOCK)
        .execute(&mut *conn)
        .await;
    result.map_err(|_| bad("Could not recover backup state"))?;
    phase2::audit(&a, &u, None, "backup.recovered").await?;
    Ok(Json(json!({"ok":true})))
}
async fn download(State(a): State<App>, h: HeaderMap, Path(id): Path<Uuid>) -> Result<Response> {
    let u = admin(&a, &h).await?;
    let row: Option<(i64, String)> =
        sqlx::query_as("SELECT bytes,sha256 FROM backup_jobs WHERE id=$1 AND status='ready'")
            .bind(id)
            .fetch_optional(&a.db)
            .await?;
    let (size, checksum) = row.ok_or(Error(StatusCode::NOT_FOUND, "Backup is not ready"))?;
    let path = root().join(format!("{id}.tar"));
    let m = tokio::fs::symlink_metadata(&path)
        .await
        .map_err(|_| Error(StatusCode::NOT_FOUND, "Backup file unavailable"))?;
    if m.file_type().is_symlink() || !m.is_file() || size <= 0 || m.len() != size as u64 {
        return Err(bad("Backup file is invalid"));
    }
    let file = tokio::fs::File::open(path)
        .await
        .map_err(|_| bad("Backup file unavailable"))?;
    let body = Body::from_stream(stream::try_unfold(file, |mut f| async move {
        let mut b = vec![0u8; 65536];
        let n = f.read(&mut b).await?;
        if n == 0 {
            Ok::<_, std::io::Error>(None)
        } else {
            b.truncate(n);
            Ok(Some((b, f)))
        }
    }));
    phase2::audit(&a, &u, None, "backup.downloaded").await?;
    Ok(Response::builder()
        .header("Content-Type", "application/x-tar")
        .header(
            "Content-Disposition",
            format!("attachment; filename=\"agent-office-{id}.tar\""),
        )
        .header("Content-Length", size.to_string())
        .header("Cache-Control", "no-store")
        .header("X-Content-Type-Options", "nosniff")
        .header("X-Backup-Sha256", checksum)
        .body(body)
        .unwrap())
}
