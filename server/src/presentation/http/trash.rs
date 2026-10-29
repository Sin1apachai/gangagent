use super::*;
pub(crate) async fn trash_entity(
    a: &App,
    u: &User,
    wid: Uuid,
    id: Uuid,
    kind: &str,
    restore: bool,
) -> Result<Json<Value>> {
    access(a, u, wid, true).await?;
    let table = match kind {
        "task" => "tasks",
        "knowledge" => "knowledge",
        "agent" => "agents",
        _ => return Err(bad("Invalid entity")),
    };
    let state = if restore { "NULL" } else { "now()" };
    let filter = if restore { "IS NOT NULL" } else { "IS NULL" };
    let extra = if kind == "task" {
        " AND status!='running'"
    } else {
        ""
    };
    let reset = if kind == "task" {
        ",execution_requested=false,cancel_requested=false"
    } else {
        ""
    };
    let sql=format!("UPDATE {table} SET deleted_at={state},version=version+1{reset} WHERE id=$1 AND workspace_id=$2 AND deleted_at {filter}{extra}");
    let n = sqlx::query(&sql)
        .bind(id)
        .bind(wid)
        .execute(&a.db)
        .await?
        .rows_affected();
    audit(
        a,
        u,
        Some(wid),
        &format!("{kind}.{}", if restore { "restored" } else { "trashed" }),
    )
    .await?;
    changed(n)
}
macro_rules! trash_handler {
    ($name:ident,$kind:literal,$restore:literal) => {
        pub(crate) async fn $name(
            State(a): State<App>,
            h: HeaderMap,
            Path((wid, id)): Path<(Uuid, Uuid)>,
        ) -> Result<Json<Value>> {
            let u = user(&a, &h).await?;
            trash_entity(&a, &u, wid, id, $kind, $restore).await
        }
    };
}
trash_handler!(delete_task, "task", false);
trash_handler!(restore_task, "task", true);
trash_handler!(delete_knowledge, "knowledge", false);
trash_handler!(restore_knowledge, "knowledge", true);
trash_handler!(delete_agent, "agent", false);
trash_handler!(restore_agent, "agent", true);
pub(crate) async fn workspace_trash(
    State(a): State<App>,
    h: HeaderMap,
    Path(wid): Path<Uuid>,
) -> Result<Json<Value>> {
    let u = user(&a, &h).await?;
    access(&a, &u, wid, false).await?;
    let mut out = json!({});
    for table in ["tasks", "knowledge", "agents"] {
        let sql=format!("SELECT row_to_json(t) FROM {table} t WHERE workspace_id=$1 AND deleted_at IS NOT NULL ORDER BY deleted_at DESC");
        out[table] = json!(
            sqlx::query_scalar::<_, Value>(&sql)
                .bind(wid)
                .fetch_all(&a.db)
                .await?
        );
    }
    Ok(Json(out))
}
