use super::*;
pub fn routes() -> Router<App> {
    Router::new()
        .route("/personal-workers", get(list).post(create))
        .route("/personal-workers/{id}", axum::routing::delete(revoke))
}
async fn list(State(a): State<App>, h: HeaderMap) -> Result<Json<Value>> {
    let u = user(&a, &h).await?;
    let rows:Vec<Value>=sqlx::query_scalar("SELECT jsonb_build_object('id',id,'label',label,'worker_id',worker_id,'created_at',created_at,'revoked_at',revoked_at) FROM worker_bindings WHERE user_id=$1 ORDER BY created_at DESC").bind(u.id).fetch_all(&a.db).await?;
    Ok(Json(json!(rows)))
}
#[derive(Deserialize)]
struct Pair {
    label: String,
}
async fn create(State(a): State<App>, h: HeaderMap, Json(b): Json<Pair>) -> Result<Json<Value>> {
    let u = user(&a, &h).await?;
    if !valid(&b.label, 80) {
        return Err(bad("Worker label required (maximum 80 bytes)"));
    }
    let mut tx = a.db.begin().await?;
    sqlx::query("SELECT id FROM users WHERE id=$1 FOR UPDATE")
        .bind(u.id)
        .execute(&mut *tx)
        .await?;
    let count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM worker_bindings WHERE user_id=$1 AND revoked_at IS NULL",
    )
    .bind(u.id)
    .fetch_one(&mut *tx)
    .await?;
    if count >= 5 {
        return Err(bad(
            "Revoke an existing worker before adding another (maximum 5)",
        ));
    }
    let id = Uuid::new_v4();
    let role = format!("ow_{}", id.simple());
    let worker = format!("personal-{id}");
    let secret = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
    // Role and password contain generated hexadecimal characters only; never interpolate user input.
    sqlx::query(&format!("CREATE ROLE {role} LOGIN PASSWORD '{secret}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS")).execute(&mut *tx).await?;
    sqlx::query(&format!("GRANT USAGE ON SCHEMA public TO {role}"))
        .execute(&mut *tx)
        .await?;
    sqlx::query(&format!(
        "GRANT SELECT(id,email,name,is_super_admin,deleted_at) ON users TO {role}"
    ))
    .execute(&mut *tx)
    .await?;
    sqlx::query(&format!("GRANT SELECT ON office_maintenance,workspaces,memberships,agents,knowledge,plans,task_dependencies,task_attachments TO {role}")).execute(&mut *tx).await?;
    sqlx::query(&format!(
        "GRANT SELECT,UPDATE ON tasks,provider_connections,provider_logins TO {role}"
    ))
    .execute(&mut *tx)
    .await?;
    sqlx::query(&format!(
        "GRANT SELECT,INSERT,UPDATE ON workers,task_runs TO {role}"
    ))
    .execute(&mut *tx)
    .await?;
    sqlx::query(&format!(
        "GRANT SELECT,INSERT ON task_events,artifacts TO {role}"
    ))
    .execute(&mut *tx)
    .await?;
    sqlx::query(&format!(
        "GRANT USAGE ON SEQUENCE task_events_id_seq TO {role}"
    ))
    .execute(&mut *tx)
    .await?;
    let linux_uid:i32=sqlx::query_scalar("INSERT INTO worker_bindings(id,user_id,worker_id,db_role,redis_hash,label) VALUES($1,$2,$3,$4,$5,$6) RETURNING linux_uid").bind(id).bind(u.id).bind(&worker).bind(&role).bind(digest(&secret)).bind(b.label.trim()).fetch_one(&mut *tx).await?;
    tx.commit().await?;
    phase2::audit(&a, &u, None, "personal_worker.created").await?;
    sync_acl(&a).await.map_err(|_| {
        Error(
            StatusCode::SERVICE_UNAVAILABLE,
            "Worker created, but Redis unavailable; revoke and retry",
        )
    })?;
    let database =
        a.db.connect_options()
            .get_database()
            .unwrap_or("office")
            .to_string();
    let network = std::env::var("OFFICE_DOCKER_NETWORK").unwrap_or("agent-office_default".into());
    let volume = std::env::var("OFFICE_RUNS_VOLUME").unwrap_or("agent-office_runs-data".into());
    let compose = json!({"name":format!("office-personal-{}",id.simple()),"services":{"worker":{"image":"agent-office-worker:latest","user":"0:0","command":["/app/agent-office","--worker"],"init":true,"restart":"unless-stopped","pids_limit":256,"mem_limit":"2g","environment":{"DATABASE_URL":format!("postgres://{role}:{secret}@postgres:5432/{database}"),"REDIS_URL":format!("redis://{role}:{secret}@redis:6379"),"OWNER_EMAIL":u.email,"WORKER_ID":worker,"MODEL_UID":linux_uid.to_string()},"volumes":["runs:/data","codex:/home/office/.codex","claude:/home/office/.claude"],"networks":["office"]}},"volumes":{"runs":{"external":true,"name":volume},"codex":{},"claude":{}},"networks":{"office":{"external":true,"name":network}}});
    Ok(Json(json!({"id":id,"compose":compose})))
}
async fn revoke(State(a): State<App>, h: HeaderMap, Path(id): Path<Uuid>) -> Result<Json<Value>> {
    let u = user(&a, &h).await?;
    let role:Option<String>=sqlx::query_scalar("UPDATE worker_bindings SET revoked_at=coalesce(revoked_at,now()) WHERE id=$1 AND user_id=$2 RETURNING db_role").bind(id).bind(u.id).fetch_optional(&a.db).await?;
    let role = role.ok_or(Error(StatusCode::NOT_FOUND, "Worker not found"))?;
    // Binding roles are always generated internally, including after restore.
    if role.len() != 35
        || !role.starts_with("ow_")
        || !role[3..].bytes().all(|c| c.is_ascii_hexdigit())
    {
        return Err(bad("Invalid worker role"));
    }
    sqlx::query(&format!("ALTER ROLE {role} NOLOGIN"))
        .execute(&a.db)
        .await?;
    sqlx::query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename=$1 AND pid<>pg_backend_pid()").bind(&role).execute(&a.db).await?;
    sync_acl(&a).await.map_err(|_| {
        Error(
            StatusCode::SERVICE_UNAVAILABLE,
            "Database access revoked; Redis cleanup pending",
        )
    })?;
    phase2::audit(&a, &u, None, "personal_worker.revoked").await?;
    Ok(Json(json!({"ok":true})))
}
async fn sync_acl(a: &App) -> std::result::Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let rows:Vec<(String,String,Uuid,bool)>=sqlx::query_as("SELECT db_role,redis_hash,user_id,revoked_at IS NOT NULL OR NOT EXISTS(SELECT 1 FROM users u WHERE u.id=user_id AND u.deleted_at IS NULL) FROM worker_bindings").fetch_all(&a.db).await?;
    let mut c = a.redis.get_multiplexed_async_connection().await?;
    for (role, hash, uid, revoked) in rows {
        if revoked {
            let _: i64 = redis::cmd("ACL")
                .arg("DELUSER")
                .arg(role)
                .query_async(&mut c)
                .await?;
        } else {
            let _: String = redis::cmd("ACL")
                .arg("SETUSER")
                .arg(role)
                .arg("reset")
                .arg("on")
                .arg(format!("#{hash}"))
                .arg(format!("~provider-login-input:{uid}:*"))
                .arg("+getdel")
                .arg("+del")
                .arg("+ping")
                .arg("+hello")
                .arg("+auth")
                .arg("+select")
                .arg("+client|setinfo")
                .arg("+client|setname")
                .query_async(&mut c)
                .await?;
        }
    }
    Ok(())
}
pub fn reconcile(a: App) {
    tokio::spawn(async move {
        loop {
            if sync_acl(&a).await.is_err() {
                eprintln!("Personal worker ACL reconciliation pending");
            }
            tokio::time::sleep(std::time::Duration::from_secs(5)).await;
        }
    });
}
