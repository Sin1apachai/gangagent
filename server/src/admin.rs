use super::*;
#[derive(Deserialize)]
pub(crate) struct NewUser {
    email: String,
    name: String,
    password: String,
}
pub(crate) async fn create_user(
    State(a): State<App>,
    h: HeaderMap,
    Json(b): Json<NewUser>,
) -> Result<Json<Value>> {
    let u = user(&a, &h).await?;
    if !u.is_super_admin {
        return Err(Error(StatusCode::FORBIDDEN, "Super admin required"));
    }
    if !valid(&b.email, 254)
        || !b.email.contains('@')
        || !valid(&b.name, 100)
        || b.password.len() < 12
        || b.password.len() > 256
    {
        return Err(bad(
            "Valid email, name and password of 12–256 bytes required",
        ));
    }
    let hash = tokio::task::spawn_blocking(move || {
        Argon2::default()
            .hash_password(b.password.as_bytes(), &SaltString::generate(&mut OsRng))
            .unwrap()
            .to_string()
    })
    .await
    .map_err(|_| bad("Password hashing failed"))?;
    let id = Uuid::new_v4();
    let r=sqlx::query("INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,$3,$4) ON CONFLICT(email) DO NOTHING").bind(id).bind(b.email.trim().to_lowercase()).bind(b.name).bind(hash).execute(&a.db).await?;
    if r.rows_affected() == 0 {
        return Err(Error(StatusCode::CONFLICT, "Email already exists"));
    }
    Ok(Json(json!({"id":id})))
}
