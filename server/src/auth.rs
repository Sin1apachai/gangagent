use super::*;
pub(crate) fn cookie_token(h: &HeaderMap) -> Option<&str> {
    h.get(header::COOKIE)?
        .to_str()
        .ok()?
        .split(';')
        .find_map(|v| v.trim().strip_prefix("office_session="))
}
pub(crate) async fn user(a: &App, h: &HeaderMap) -> Result<User> {
    let token = cookie_token(h).ok_or(Error(StatusCode::UNAUTHORIZED, "Sign in required"))?;
    sqlx::query_as::<_,User>("SELECT u.id,u.email,u.name,u.is_super_admin FROM sessions s JOIN users u ON u.id=s.user_id WHERE token_hash=$1 AND expires_at>now() AND u.deleted_at IS NULL")
 .bind(digest(token)).fetch_optional(&a.db).await?.ok_or(Error(StatusCode::UNAUTHORIZED,"Session expired"))
}
pub(crate) async fn access(a: &App, u: &User, id: Uuid, write: bool) -> Result<()> {
    let role: Option<String> =
        sqlx::query_scalar("SELECT role FROM memberships WHERE workspace_id=$1 AND user_id=$2")
            .bind(id)
            .bind(u.id)
            .fetch_optional(&a.db)
            .await?;
    if !u.is_super_admin && (role.is_none() || (write && role.as_deref() == Some("viewer"))) {
        return Err(Error(StatusCode::FORBIDDEN, "Workspace access denied"));
    }
    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM workspaces WHERE id=$1 AND deleted_at IS NULL)",
    )
    .bind(id)
    .fetch_one(&a.db)
    .await?;
    if !exists {
        return Err(Error(StatusCode::NOT_FOUND, "Workspace not found"));
    }
    Ok(())
}
pub(crate) async fn protect(req: Request, next: Next) -> Response {
    if !matches!(
        *req.method(),
        axum::http::Method::GET | axum::http::Method::HEAD | axum::http::Method::OPTIONS
    ) && req
        .headers()
        .get("x-office-client")
        .and_then(|v| v.to_str().ok())
        != Some("1")
    {
        return Error(StatusCode::FORBIDDEN, "Client header required").into_response();
    }
    let mut r = next.run(req).await;
    r.headers_mut()
        .insert(header::X_CONTENT_TYPE_OPTIONS, "nosniff".parse().unwrap());
    r.headers_mut()
        .insert(header::X_FRAME_OPTIONS, "DENY".parse().unwrap());
    r.headers_mut()
        .insert(header::CACHE_CONTROL, "no-store".parse().unwrap());
    r
}
pub(crate) async fn health(State(a): State<App>) -> Result<Json<Value>> {
    sqlx::query("SELECT 1").execute(&a.db).await?;
    let mut c = a
        .redis
        .get_multiplexed_async_connection()
        .await
        .map_err(|_| Error(StatusCode::SERVICE_UNAVAILABLE, "Redis unavailable"))?;
    let _: String = redis::cmd("PING")
        .query_async(&mut c)
        .await
        .map_err(|_| Error(StatusCode::SERVICE_UNAVAILABLE, "Redis unavailable"))?;
    Ok(Json(
        json!({"status":"ok","postgres":true,"redis":true,"ai_execution":"worker_requires_provider_login","billing_mode":"subscription_only"}),
    ))
}
#[derive(Deserialize)]
pub(crate) struct Login {
    email: String,
    password: String,
}
pub(crate) async fn login(State(a): State<App>, Json(b): Json<Login>) -> Result<Response> {
    if !valid(&b.email, 254) || !valid(&b.password, 256) {
        return Err(bad("Invalid credentials"));
    }
    let email = b.email.trim().to_lowercase();
    let mut c = a
        .redis
        .get_multiplexed_async_connection()
        .await
        .map_err(|_| {
            Error(
                StatusCode::SERVICE_UNAVAILABLE,
                "Login temporarily unavailable",
            )
        })?;
    let key = format!("login:{}", digest(&email));
    let n: i64 = redis::cmd("INCR")
        .arg(&key)
        .query_async(&mut c)
        .await
        .map_err(|_| {
            Error(
                StatusCode::SERVICE_UNAVAILABLE,
                "Login temporarily unavailable",
            )
        })?;
    if n == 1 {
        let _: i64 = redis::cmd("EXPIRE")
            .arg(&key)
            .arg(900)
            .query_async(&mut c)
            .await
            .map_err(|_| {
                Error(
                    StatusCode::SERVICE_UNAVAILABLE,
                    "Login temporarily unavailable",
                )
            })?;
    }
    if n > 10 {
        return Err(Error(
            StatusCode::TOO_MANY_REQUESTS,
            "Too many attempts; wait 15 minutes",
        ));
    }
    let row: Option<(Uuid, String)> =
        sqlx::query_as("SELECT id,password_hash FROM users WHERE email=$1 AND deleted_at IS NULL")
            .bind(email)
            .fetch_optional(&a.db)
            .await?;
    let Some((id, hash)) = row else {
        return Err(Error(StatusCode::UNAUTHORIZED, "Invalid email or password"));
    };
    let ok = tokio::task::spawn_blocking(move || {
        PasswordHash::new(&hash)
            .map(|h| {
                Argon2::default()
                    .verify_password(b.password.as_bytes(), &h)
                    .is_ok()
            })
            .unwrap_or(false)
    })
    .await
    .unwrap_or(false);
    if !ok {
        return Err(Error(StatusCode::UNAUTHORIZED, "Invalid email or password"));
    }
    let _: std::result::Result<i64, _> = redis::cmd("DEL").arg(&key).query_async(&mut c).await;
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    let token = bytes.iter().map(|b| format!("{b:02x}")).collect::<String>();
    sqlx::query("INSERT INTO sessions VALUES($1,$2,now()+interval '7 days')")
        .bind(digest(&token))
        .bind(id)
        .execute(&a.db)
        .await?;
    let secure = if std::env::var("COOKIE_SECURE").as_deref() == Ok("true") {
        "; Secure"
    } else {
        ""
    };
    Ok((
        [(
            header::SET_COOKIE,
            format!(
                "office_session={token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800{secure}"
            ),
        )],
        Json(json!({"ok":true})),
    )
        .into_response())
}
pub(crate) async fn logout(State(a): State<App>, h: HeaderMap) -> Result<Response> {
    if let Some(t) = cookie_token(&h) {
        sqlx::query("DELETE FROM sessions WHERE token_hash=$1")
            .bind(digest(t))
            .execute(&a.db)
            .await?;
    }
    Ok((
        [(
            header::SET_COOKIE,
            "office_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
        )],
        Json(json!({"ok":true})),
    )
        .into_response())
}
pub(crate) async fn me(State(a): State<App>, h: HeaderMap) -> Result<Json<User>> {
    Ok(Json(user(&a, &h).await?))
}
