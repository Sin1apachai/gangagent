use super::*;

pub fn routes() -> Router<App> {
    Router::new()
        .route("/connections/{provider}/login", post(start))
        .route("/connections/login/{id}/cancel", post(cancel))
        .route("/connections/login/{id}/code", post(code))
}
#[derive(Deserialize)]
struct LoginOptions {
    #[serde(default)]
    reconnect: bool,
}
async fn start(
    State(a): State<App>,
    h: HeaderMap,
    Path(provider): Path<String>,
    Json(options): Json<LoginOptions>,
) -> Result<Json<Value>> {
    let u = user(&a, &h).await?;
    if !matches!(provider.as_str(), "codex" | "claude") {
        return Err(bad("Unsupported provider"));
    }
    let mut tx = a.db.begin().await?;
    // Lock the worker to serialize requests, regardless of which provider was selected.
    let row: Option<(String, Value, String)> = sqlx::query_as("SELECT id,providers,mode FROM workers WHERE user_id=$1 AND heartbeat_at>now()-interval '20 seconds' ORDER BY id FOR UPDATE LIMIT 1")
        .bind(u.id).fetch_optional(&mut *tx).await?;
    let (worker, providers, mode) = row.ok_or(Error(
        StatusCode::CONFLICT,
        "Your worker is offline or has not been paired",
    ))?;
    if mode != "fixture" && providers[&provider]["authenticated"] == true && !options.reconnect {
        return Err(Error(
            StatusCode::CONFLICT,
            "This provider is already connected",
        ));
    }
    sqlx::query("UPDATE provider_logins SET status='expired',login_url='',device_code='' WHERE worker_id=$1 AND expires_at<=now() AND status IN ('queued','starting','waiting')")
        .bind(&worker).execute(&mut *tx).await?;
    let existing: Option<Uuid> = sqlx::query_scalar("SELECT id FROM provider_logins WHERE worker_id=$1 AND status IN ('queued','starting','waiting')")
        .bind(&worker).fetch_optional(&mut *tx).await?;
    if existing.is_some() {
        return Err(Error(
            StatusCode::CONFLICT,
            "Finish or cancel the current sign-in first",
        ));
    }
    let id = Uuid::new_v4();
    sqlx::query("INSERT INTO provider_logins(id,user_id,worker_id,provider,status,reconnect) VALUES($1,$2,$3,$4,'queued',$5)")
        .bind(id).bind(u.id).bind(worker).bind(provider).bind(options.reconnect).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(Json(json!({"id":id})))
}
async fn cancel(State(a): State<App>, h: HeaderMap, Path(id): Path<Uuid>) -> Result<Json<Value>> {
    let u = user(&a, &h).await?;
    let n = sqlx::query("UPDATE provider_logins SET status='cancelled',login_url='',device_code='' WHERE id=$1 AND user_id=$2 AND status IN ('queued','starting','waiting')")
        .bind(id).bind(u.id).execute(&a.db).await?.rows_affected();
    if n == 0 {
        return Err(Error(StatusCode::NOT_FOUND, "Active sign-in not found"));
    }
    if let Ok(mut redis) = a.redis.get_multiplexed_async_connection().await {
        let _: redis::RedisResult<i64> = redis::cmd("DEL")
            .arg(format!("provider-login-input:{}:{id}", u.id))
            .query_async(&mut redis)
            .await;
    }
    Ok(Json(json!({"ok":true})))
}
#[derive(Deserialize)]
struct AuthCode {
    code: String,
}
async fn code(
    State(a): State<App>,
    h: HeaderMap,
    Path(id): Path<Uuid>,
    Json(b): Json<AuthCode>,
) -> Result<Json<Value>> {
    let u = user(&a, &h).await?;
    if !valid(&b.code, 4096) || b.code.starts_with("sk-") || b.code.chars().any(char::is_whitespace)
    {
        return Err(bad("Enter the one-time authorization code only"));
    }
    let allowed: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM provider_logins WHERE id=$1 AND user_id=$2 AND provider='claude' AND status='waiting' AND login_url!='' AND expires_at>now())")
        .bind(id).bind(u.id).fetch_one(&a.db).await?;
    if !allowed {
        return Err(Error(
            StatusCode::NOT_FOUND,
            "Active Claude sign-in not found",
        ));
    }
    // Short-lived authorization code only: memory-only Redis, never PostgreSQL or logs.
    let mut redis = a
        .redis
        .get_multiplexed_async_connection()
        .await
        .map_err(|_| {
            Error(
                StatusCode::SERVICE_UNAVAILABLE,
                "Sign-in temporarily unavailable",
            )
        })?;
    let _: () = redis::cmd("SET")
        .arg(format!("provider-login-input:{}:{id}", u.id))
        .arg(b.code.trim())
        .arg("EX")
        .arg(60)
        .query_async(&mut redis)
        .await
        .map_err(|_| {
            Error(
                StatusCode::SERVICE_UNAVAILABLE,
                "Sign-in temporarily unavailable",
            )
        })?;
    Ok(Json(json!({"ok":true})))
}
