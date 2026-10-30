use super::*;
use std::{
    collections::BTreeSet,
    path::{Path as FsPath, PathBuf},
    process::Stdio,
    time::{Duration, Instant},
};
use tokio::{io::AsyncReadExt, process::Command};
type BResult<T> = std::result::Result<T, Box<dyn std::error::Error + Send + Sync>>;
const MAX_BYTES: u64 = 2 * 1024 * 1024 * 1024;
async fn beat(db: &PgPool) -> BResult<()> {
    sqlx::query("UPDATE backup_service SET heartbeat_at=now(),resources=$1 WHERE id")
        .bind(crate::resource_metrics::node())
        .execute(db)
        .await?;
    Ok(())
}
async fn stop(db: &PgPool, id: Uuid) -> BResult<()> {
    let yes:bool=sqlx::query_scalar("SELECT cancel_requested OR status NOT IN ('waiting','snapshotting','archiving') FROM backup_jobs WHERE id=$1").bind(id).fetch_one(db).await?;
    if yes {
        return Err("Backup cancelled".into());
    }
    Ok(())
}
async fn stage(db: &PgPool, id: Uuid, state: &str, msg: &str) -> BResult<()> {
    stop(db, id).await?;
    sqlx::query("UPDATE backup_jobs SET status=$1,message=$2 WHERE id=$3 AND NOT cancel_requested AND status IN ('waiting','snapshotting','archiving')").bind(state).bind(msg).bind(id).execute(db).await?;
    Ok(())
}
async fn unpause(db: &PgPool, job: Option<Uuid>) -> BResult<()> {
    let mut tx = db.begin().await?;
    sqlx::query("UPDATE office_maintenance SET paused=false WHERE id AND EXISTS(SELECT 1 FROM backup_service WHERE id AND pause_owned AND ($1::uuid IS NULL OR pause_job=$1))").bind(job).execute(&mut *tx).await?;
    sqlx::query("UPDATE backup_service SET pause_owned=false,pause_job=NULL WHERE id AND ($1::uuid IS NULL OR pause_job=$1)")
        .bind(job).execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(())
}
pub(super) async fn recover(db: &PgPool) -> BResult<()> {
    unpause(db, None).await?;
    sqlx::query("UPDATE backup_jobs SET status=CASE WHEN cancel_requested THEN 'cancelled' ELSE 'failed' END,message='Backup interrupted; create a new backup',finished_at=now() WHERE status IN ('waiting','snapshotting','archiving')").execute(db).await?;
    Ok(())
}
fn command(program: &str) -> Command {
    let mut c = Command::new(program);
    c.env_clear()
        .env("PATH", "/usr/local/bin:/usr/bin:/bin")
        .env("LC_ALL", "C.UTF-8")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    c
}
async fn execute(db: &PgPool, id: Uuid, mut c: Command, output: &FsPath) -> BResult<()> {
    let mut child = c.spawn()?;
    let start = Instant::now();
    loop {
        tokio::select! {
         r=child.wait()=>{if !r?.success(){return Err("Backup subprocess failed".into());}break;},
         _=tokio::time::sleep(Duration::from_millis(500))=>{
          beat(db).await?;stop(db,id).await?;
          let size=tokio::fs::metadata(output).await.map(|m|m.len()).unwrap_or(0);
          if size>MAX_BYTES || start.elapsed()>Duration::from_secs(600){return Err("Backup size or time limit exceeded".into());}
         }
        }
    }
    if tokio::fs::metadata(output).await?.len() > MAX_BYTES {
        return Err("Backup size limit exceeded".into());
    }
    Ok(())
}
fn validated_paths(data: &FsPath, files: &[(Uuid, String, i64)]) -> BResult<Vec<String>> {
    let mut dirs = BTreeSet::new();
    let mut names = BTreeSet::new();
    let mut total = 0u64;
    for (run, name, size) in files {
        if !phase2::safe_relative(name) || name.contains('\0') || *size < 0 {
            return Err("Unsafe registered artifact".into());
        }
        total = total
            .checked_add(*size as u64)
            .ok_or("Artifact budget exceeded")?;
        if total > MAX_BYTES {
            return Err("Artifact budget exceeded".into());
        }
        let relative = PathBuf::from("runs").join(run.to_string()).join(name);
        let mut path = data.to_path_buf();
        for c in relative.components() {
            path.push(c);
            if std::fs::symlink_metadata(&path)?.file_type().is_symlink() {
                return Err("Artifact symlink denied".into());
            }
        }
        let m = path.metadata()?;
        if !m.is_file() || m.len() != *size as u64 {
            return Err("Registered artifact missing or changed".into());
        }
        for p in relative.ancestors().skip(1) {
            if p.components().count() >= 2 {
                dirs.insert(p.to_string_lossy().to_string());
            }
        }
        names.insert(relative.to_string_lossy().to_string());
    }
    let mut dirs = dirs.into_iter().collect::<Vec<_>>();
    dirs.sort_by_key(|p| p.matches('/').count());
    dirs.extend(names);
    Ok(dirs)
}
async fn hash(path: &FsPath) -> BResult<String> {
    let mut file = tokio::fs::File::open(path).await?;
    let mut hasher = Sha256::new();
    let mut b = vec![0u8; 65536];
    loop {
        let n = file.read(&mut b).await?;
        if n == 0 {
            break;
        }
        hasher.update(&b[..n]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}
async fn bundle(db: &PgPool, id: Uuid) -> BResult<(u64, String)> {
    let work = root().join(format!("work-{id}"));
    tokio::fs::create_dir(&work).await?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        tokio::fs::set_permissions(&work, std::fs::Permissions::from_mode(0o700)).await?;
    }
    // Lock out new worker claims, preserving any maintenance pause that already existed.
    let mut pause = db.begin().await?;
    let was: bool = sqlx::query_scalar("SELECT paused FROM office_maintenance WHERE id FOR UPDATE")
        .fetch_one(&mut *pause)
        .await?;
    sqlx::query("UPDATE office_maintenance SET paused=true WHERE id")
        .execute(&mut *pause)
        .await?;
    sqlx::query("UPDATE backup_service SET pause_owned=$1,pause_job=$2 WHERE id")
        .bind(!was)
        .bind(id)
        .execute(&mut *pause)
        .await?;
    pause.commit().await?;
    let start = Instant::now();
    loop {
        beat(db).await?;
        stop(db, id).await?;
        let running: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM tasks WHERE status='running' AND lease_until>now()",
        )
        .fetch_one(db)
        .await?;
        if running == 0 {
            break;
        }
        if start.elapsed() > Duration::from_secs(960) {
            return Err("Timed out waiting for active tasks".into());
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
    stage(
        db,
        id,
        "snapshotting",
        "Saving consistent database snapshot",
    )
    .await?;
    let mut snapshot = db.begin().await?;
    sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
        .execute(&mut *snapshot)
        .await?;
    let snapshot_id: String = sqlx::query_scalar("SELECT pg_export_snapshot()")
        .fetch_one(&mut *snapshot)
        .await?;
    let files: Vec<(Uuid, String, i64)> =
        sqlx::query_as("SELECT run_id,name,size FROM artifacts ORDER BY run_id,name")
            .fetch_all(&mut *snapshot)
            .await?;
    let paths = validated_paths(FsPath::new("/data"), &files)?;
    let dump = work.join("office.dump");
    let mut c = command("pg_dump");
    for key in ["PGHOST", "PGPORT", "PGUSER", "PGPASSWORD", "PGDATABASE"] {
        c.env(key, std::env::var(key)?);
    }
    c.args([
        "--format=custom",
        "--no-owner",
        "--no-privileges",
        "--snapshot",
        &snapshot_id,
        "--file",
    ])
    .arg(&dump);
    for table in [
        "sessions",
        "provider_logins",
        "worker_bindings",
        "workers",
        "backup_jobs",
        "backup_service",
    ] {
        c.arg(format!("--exclude-table-data=public.{table}"));
    }
    execute(db, id, c, &dump).await?;
    stage(
        db,
        id,
        "archiving",
        "Packing registered artifacts and verifying checksums",
    )
    .await?;
    let paths_file = work.join("paths.nul");
    let mut data = Vec::new();
    for path in paths {
        data.extend(path.as_bytes());
        data.push(0);
    }
    tokio::fs::write(&paths_file, data).await?;
    let artifacts = work.join("artifacts.tar.gz");
    let mut tar = command("tar");
    tar.args([
        "--acls",
        "--hard-dereference",
        "--no-recursion",
        "--null",
        "--verbatim-files-from",
        "-C",
        "/data",
        "-T",
    ])
    .arg(&paths_file)
    .arg("-czf")
    .arg(&artifacts);
    execute(db, id, tar, &artifacts).await?;
    snapshot.commit().await?;
    tokio::fs::remove_file(paths_file).await?;
    let manifest = json!({"format":"agent-office-backup","version":1,"id":id,"database_snapshot":"exported repeatable-read snapshot","registered_artifact_count":files.len(),"excluded":["subscription login volumes","sessions","provider login codes","worker bindings","worker heartbeats","backup history","Redis cache"],"restore_note":"Restore in an isolated project and reconnect AI accounts/workers before starting tasks"});
    tokio::fs::write(
        work.join("manifest.json"),
        serde_json::to_vec_pretty(&manifest)?,
    )
    .await?;
    tokio::fs::write(work.join("post-restore.sql"),"UPDATE office_maintenance SET paused=false WHERE id;\nUPDATE tasks SET execution_requested=false,lease_until=NULL,status=CASE WHEN status='running' THEN 'interrupted' ELSE status END;\nUPDATE provider_connections SET enabled=false,reauth_required=true;\n").await?;
    let checksums = format!(
        "{}  office.dump\n{}  artifacts.tar.gz\n{}  manifest.json\n{}  post-restore.sql\n",
        hash(&dump).await?,
        hash(&artifacts).await?,
        hash(&work.join("manifest.json")).await?,
        hash(&work.join("post-restore.sql")).await?
    );
    tokio::fs::write(work.join("SHA256SUMS"), checksums).await?;
    let part = root().join(format!("{id}.part"));
    tokio::fs::write(&part, []).await?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        tokio::fs::set_permissions(&part, std::fs::Permissions::from_mode(0o600)).await?;
    }
    let mut tar = command("tar");
    tar.arg("-C").arg(&work).arg("-cf").arg(&part).args([
        "office.dump",
        "artifacts.tar.gz",
        "manifest.json",
        "SHA256SUMS",
        "post-restore.sql",
    ]);
    execute(db, id, tar, &part).await?;
    stop(db, id).await?;
    let checksum = hash(&part).await?;
    let size = tokio::fs::metadata(&part).await?.len();
    stop(db, id).await?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::{chown, PermissionsExt};
        chown(&part, Some(10001), Some(10001))?;
        tokio::fs::set_permissions(&part, std::fs::Permissions::from_mode(0o600)).await?;
    }
    tokio::fs::rename(&part, root().join(format!("{id}.tar"))).await?;
    Ok((size, checksum))
}
async fn clean(id: Uuid, include_final: bool) -> BResult<()> {
    let result = tokio::fs::remove_dir_all(root().join(format!("work-{id}"))).await;
    if let Err(e) = result {
        if e.kind() != std::io::ErrorKind::NotFound {
            return Err(e.into());
        }
    }
    let mut files = vec![root().join(format!("{id}.part"))];
    if include_final {
        files.push(root().join(format!("{id}.tar")));
    }
    for file in files {
        if let Err(e) = tokio::fs::remove_file(file).await {
            if e.kind() != std::io::ErrorKind::NotFound {
                return Err(e.into());
            }
        }
    }
    Ok(())
}
pub(crate) async fn run() -> BResult<()> {
    let url = std::env::var("DATABASE_URL")?;
    let db = PgPool::connect(&url).await?;
    loop {
        let ready: bool =
            sqlx::query_scalar("SELECT to_regclass('public.backup_jobs') IS NOT NULL")
                .fetch_one(&db)
                .await?;
        if ready {
            break;
        }
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
    let mut conn = db.acquire().await?;
    let locked: bool = sqlx::query_scalar("SELECT pg_try_advisory_lock($1)")
        .bind(LOCK)
        .fetch_one(&mut *conn)
        .await?;
    if !locked {
        return Err("Another backup service is active".into());
    }
    tokio::fs::create_dir_all(root()).await?;
    sqlx::query("INSERT INTO backup_service(id,heartbeat_at) VALUES(true,now()) ON CONFLICT(id) DO UPDATE SET heartbeat_at=now()").execute(&db).await?;
    recover(&db).await?;
    let heart = db.clone();
    tokio::spawn(async move {
        loop {
            if beat(&heart).await.is_err() {
                break;
            }
            tokio::time::sleep(Duration::from_secs(2)).await;
        }
    });

    let leftovers:Vec<(Uuid,String)>=sqlx::query_as("SELECT id,status FROM backup_jobs WHERE status IN ('ready','failed','cancelled','deleted')").fetch_all(&db).await?;
    for (id, status) in leftovers {
        clean(id, status != "ready").await?;
    }
    loop {
        // Keep the lock connection alive; loss of it must stop this coordinator.
        sqlx::query("SELECT 1").execute(&mut *conn).await?;
        beat(&db).await?;
        let deleting: Vec<Uuid> =
            sqlx::query_scalar("SELECT id FROM backup_jobs WHERE status='deleting'")
                .fetch_all(&db)
                .await?;
        for id in deleting {
            clean(id, true).await?;
            sqlx::query("UPDATE backup_jobs SET status='deleted',message='Deleted' WHERE id=$1 AND status='deleting'").bind(id).execute(&db).await?;
        }
        let id:Option<Uuid>=sqlx::query_scalar("UPDATE backup_jobs SET status='waiting',started_at=now(),message='Waiting for active AI tasks to finish' WHERE id=(SELECT id FROM backup_jobs WHERE status='queued' ORDER BY created_at LIMIT 1) AND status='queued' RETURNING id").fetch_optional(&db).await?;
        if let Some(id) = id {
            let outcome = bundle(&db, id).await;
            let resume = unpause(&db, Some(id)).await;
            match outcome {
                Ok((size, checksum)) if resume.is_ok() => {
                    let n=sqlx::query("UPDATE backup_jobs SET status='ready',message='Ready to download',bytes=$1,sha256=$2,finished_at=now() WHERE id=$3 AND NOT cancel_requested AND status IN ('snapshotting','archiving')").bind(size as i64).bind(checksum).bind(id).execute(&db).await?.rows_affected();
                    clean(id, n == 0).await?;
                    if n == 0 {
                        sqlx::query("UPDATE backup_jobs SET status='cancelled',finished_at=now(),message='Cancelled' WHERE id=$1 AND cancel_requested").bind(id).execute(&db).await?;
                    }
                }
                _ => {
                    clean(id, true).await?;
                    sqlx::query("UPDATE backup_jobs SET status=CASE WHEN cancel_requested THEN 'cancelled' ELSE 'failed' END,message='Backup stopped; no downloadable partial file. Retry or check service storage and registered artifacts.',finished_at=now() WHERE id=$1 AND status!='deleted'").bind(id).execute(&db).await?;
                }
            }
            resume?;
        }
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn artifact_manifest_rejects_traversal_symlinks_and_changed_size() {
        let root = std::env::temp_dir().join(format!("backup-check-{}", Uuid::new_v4()));
        let run = Uuid::new_v4();
        let dir = root.join("runs").join(run.to_string());
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("proof.txt"), "good").unwrap();
        assert!(validated_paths(&root, &[(run, "proof.txt".into(), 4)]).is_ok());
        assert!(validated_paths(&root, &[(run, "../outside".into(), 4)]).is_err());
        assert!(validated_paths(&root, &[(run, "proof.txt".into(), 5)]).is_err());
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(dir.join("proof.txt"), dir.join("link.txt")).unwrap();
            assert!(validated_paths(&root, &[(run, "link.txt".into(), 4)]).is_err());
        }
        std::fs::remove_dir_all(root).unwrap();
    }
}
