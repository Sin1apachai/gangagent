use super::*;
#[derive(Deserialize)]
pub(crate) struct UserForm {
    name: String,
    email: String,
    #[serde(default)]
    password: String,
    #[serde(default)]
    current_password: String,
}
pub(crate) async fn save_user(a: &App, id: Uuid, b: UserForm) -> Result<Json<Value>> {
    if !valid(&b.name, 100)
        || !valid(&b.email, 254)
        || !b.email.contains('@')
        || !b.password.is_empty() && (b.password.len() < 12 || b.password.len() > 256)
    {
        return Err(bad(
            "Valid name, email and optional password of 12–256 bytes required",
        ));
    }
    let hash = if b.password.is_empty() {
        None
    } else {
        Some(
            tokio::task::spawn_blocking(move || {
                Argon2::default()
                    .hash_password(b.password.as_bytes(), &SaltString::generate(&mut OsRng))
                    .unwrap()
                    .to_string()
            })
            .await
            .map_err(|_| bad("Password hashing failed"))?,
        )
    };
    let mut tx = a.db.begin().await?;
    let duplicate: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM users WHERE email=$1 AND id!=$2)")
            .bind(b.email.trim().to_lowercase())
            .bind(id)
            .fetch_one(&mut *tx)
            .await?;
    if duplicate {
        return Err(Error(StatusCode::CONFLICT, "Email already exists"));
    }
    let n=sqlx::query("UPDATE users SET name=$1,email=$2,password_hash=COALESCE($3,password_hash) WHERE id=$4 AND deleted_at IS NULL").bind(b.name).bind(b.email.trim().to_lowercase()).bind(&hash).bind(id).execute(&mut *tx).await?.rows_affected();
    if hash.is_some() {
        sqlx::query("DELETE FROM sessions WHERE user_id=$1")
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    changed(n)
}
pub(crate) async fn profile(
    State(a): State<App>,
    h: HeaderMap,
    Json(b): Json<UserForm>,
) -> Result<Json<Value>> {
    let u = user(&a, &h).await?;
    if !b.password.is_empty() || b.email.trim().to_lowercase() != u.email {
        let hash: String = sqlx::query_scalar("SELECT password_hash FROM users WHERE id=$1")
            .bind(u.id)
            .fetch_one(&a.db)
            .await?;
        let pw = b.current_password.clone();
        let ok = tokio::task::spawn_blocking(move || {
            PasswordHash::new(&hash)
                .map(|h| Argon2::default().verify_password(pw.as_bytes(), &h).is_ok())
                .unwrap_or(false)
        })
        .await
        .unwrap_or(false);
        if !ok {
            return Err(Error(StatusCode::UNAUTHORIZED, "Current password required"));
        }
    }
    save_user(&a, u.id, b).await
}
pub(crate) async fn list_users(State(a): State<App>, h: HeaderMap) -> Result<Json<Vec<Value>>> {
    let u = user(&a, &h).await?;
    if !u.is_super_admin {
        return Err(Error(StatusCode::FORBIDDEN, "Super admin required"));
    }
    Ok(Json(sqlx::query_scalar("SELECT json_build_object('id',id,'name',name,'email',email,'is_super_admin',is_super_admin,'deleted_at',deleted_at,'intelligence_access',EXISTS(SELECT 1 FROM intelligence_grants g WHERE g.user_id=users.id)) FROM users ORDER BY created_at").fetch_all(&a.db).await?))
}
pub(crate) async fn edit_user(
    State(a): State<App>,
    h: HeaderMap,
    Path(id): Path<Uuid>,
    Json(b): Json<UserForm>,
) -> Result<Json<Value>> {
    let u = user(&a, &h).await?;
    if !u.is_super_admin || id == u.id {
        return Err(Error(
            StatusCode::FORBIDDEN,
            "Use Profile for your own account; Super admin required for other users",
        ));
    }
    save_user(&a, id, b).await
}
pub(crate) async fn delete_user(
    State(a): State<App>,
    h: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>> {
    let u = user(&a, &h).await?;
    if !u.is_super_admin || id == u.id {
        return Err(Error(
            StatusCode::FORBIDDEN,
            "Cannot delete your own account",
        ));
    }
    let mut tx = a.db.begin().await?;
    let n=sqlx::query("UPDATE users SET deleted_at=now() WHERE id=$1 AND NOT is_super_admin AND deleted_at IS NULL").bind(id).execute(&mut *tx).await?.rows_affected();
    sqlx::query("DELETE FROM sessions WHERE user_id=$1")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    if n > 0 {
        invalidate_execution(&mut tx, None, Some(id), None).await?;
    }
    tx.commit().await?;
    changed(n)
}
pub(crate) async fn restore_user(
    State(a): State<App>,
    h: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>> {
    let u = user(&a, &h).await?;
    if !u.is_super_admin {
        return Err(Error(StatusCode::FORBIDDEN, "Super admin required"));
    }
    changed(
        sqlx::query("UPDATE users SET deleted_at=NULL WHERE id=$1 AND deleted_at IS NOT NULL")
            .bind(id)
            .execute(&a.db)
            .await?
            .rows_affected(),
    )
}
pub(crate) async fn members(
    State(a): State<App>,
    h: HeaderMap,
    Path(wid): Path<Uuid>,
) -> Result<Json<Vec<Value>>> {
    let u = user(&a, &h).await?;
    owner(&a, &u, wid).await?;
    Ok(Json(sqlx::query_scalar("SELECT json_build_object('id',u.id,'name',u.name,'email',u.email,'role',m.role) FROM memberships m JOIN users u ON u.id=m.user_id WHERE workspace_id=$1 AND u.deleted_at IS NULL").bind(wid).fetch_all(&a.db).await?))
}
