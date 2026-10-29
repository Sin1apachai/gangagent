use super::*;
#[derive(Deserialize)]
pub(crate) struct MemberForm {
    email: String,
    role: String,
}
pub(crate) async fn save_member(
    State(a): State<App>,
    h: HeaderMap,
    Path(wid): Path<Uuid>,
    Json(b): Json<MemberForm>,
) -> Result<Json<Value>> {
    let u = user(&a, &h).await?;
    owner(&a, &u, wid).await?;
    if !matches!(b.role.as_str(), "member" | "viewer") {
        return Err(bad(
            "Choose member or viewer; owner transfer is not supported",
        ));
    }
    let id: Uuid = sqlx::query_scalar("SELECT id FROM users WHERE email=$1 AND deleted_at IS NULL")
        .bind(b.email.trim().to_lowercase())
        .fetch_optional(&a.db)
        .await?
        .ok_or(bad("Create this user account first"))?;
    let mut tx = a.db.begin().await?;
    let n=sqlx::query("INSERT INTO memberships VALUES($1,$2,$3) ON CONFLICT(workspace_id,user_id) DO UPDATE SET role=EXCLUDED.role WHERE memberships.role!='owner'").bind(wid).bind(id).bind(&b.role).execute(&mut *tx).await?.rows_affected();
    if n > 0 && b.role == "viewer" {
        invalidate_execution(&mut tx, Some(wid), Some(id), None).await?;
    }
    tx.commit().await?;
    changed(n)
}
pub(crate) async fn remove_member(
    State(a): State<App>,
    h: HeaderMap,
    Path((wid, id)): Path<(Uuid, Uuid)>,
) -> Result<Json<Value>> {
    let u = user(&a, &h).await?;
    owner(&a, &u, wid).await?;
    let mut tx = a.db.begin().await?;
    let n = sqlx::query(
        "DELETE FROM memberships WHERE workspace_id=$1 AND user_id=$2 AND role!='owner'",
    )
    .bind(wid)
    .bind(id)
    .execute(&mut *tx)
    .await?
    .rows_affected();
    if n > 0 {
        invalidate_execution(&mut tx, Some(wid), Some(id), None).await?;
    }
    tx.commit().await?;
    changed(n)
}
