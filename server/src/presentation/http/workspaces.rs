use super::*;
#[derive(Deserialize)]
pub(crate) struct VersionName {
    name: String,
    version: i32,
}
pub(crate) async fn rename_workspace(
    State(a): State<App>,
    h: HeaderMap,
    Path(id): Path<Uuid>,
    Json(b): Json<VersionName>,
) -> Result<Json<Value>> {
    let u = user(&a, &h).await?;
    owner(&a, &u, id).await?;
    if !valid(&b.name, 100) {
        return Err(bad("Workspace name is required (max 100 bytes)"));
    }
    let n=sqlx::query("UPDATE workspaces SET name=$1,version=version+1 WHERE id=$2 AND version=$3 AND deleted_at IS NULL").bind(b.name.trim()).bind(id).bind(b.version).execute(&a.db).await?.rows_affected();
    audit(&a, &u, Some(id), "workspace.updated").await?;
    changed(n)
}
pub(crate) async fn delete_workspace(
    State(a): State<App>,
    h: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>> {
    let u = user(&a, &h).await?;
    owner(&a, &u, id).await?;
    let mut tx = a.db.begin().await?;
    sqlx::query("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE")
        .bind(id)
        .fetch_optional(&mut *tx)
        .await?;
    let running: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM tasks WHERE workspace_id=$1 AND status='running')",
    )
    .bind(id)
    .fetch_one(&mut *tx)
    .await?;
    if running {
        return Err(Error(
            StatusCode::CONFLICT,
            "Cancel running tasks before deleting this workspace",
        ));
    }
    let n=sqlx::query("UPDATE workspaces SET deleted_at=now(),version=version+1 WHERE id=$1 AND deleted_at IS NULL").bind(id).execute(&mut *tx).await?.rows_affected();
    if n > 0 {
        invalidate_execution(&mut tx, Some(id), None, None).await?;
    }
    tx.commit().await?;
    audit(&a, &u, Some(id), "workspace.trashed").await?;
    changed(n)
}
pub(crate) async fn restore_workspace(
    State(a): State<App>,
    h: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>> {
    let u = user(&a, &h).await?;
    owner(&a, &u, id).await?;
    let n=sqlx::query("UPDATE workspaces SET deleted_at=NULL,version=version+1 WHERE id=$1 AND deleted_at IS NOT NULL").bind(id).execute(&a.db).await?.rows_affected();
    changed(n)
}
pub(crate) async fn workspace_bin(State(a): State<App>, h: HeaderMap) -> Result<Json<Vec<Value>>> {
    let u = user(&a, &h).await?;
    Ok(Json(sqlx::query_scalar("SELECT json_build_object('id',w.id,'name',w.name,'deleted_at',w.deleted_at) FROM workspaces w WHERE deleted_at IS NOT NULL AND ($1 OR EXISTS(SELECT 1 FROM memberships WHERE workspace_id=w.id AND user_id=$2 AND role='owner')) ORDER BY deleted_at DESC").bind(u.is_super_admin).bind(u.id).fetch_all(&a.db).await?))
}
