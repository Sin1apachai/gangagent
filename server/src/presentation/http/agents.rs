use super::*;
#[derive(Deserialize)]
pub(crate) struct AgentForm {
    name: String,
    role: String,
    instructions: String,
    provider: String,
    x: i32,
    y: i32,
    enabled: bool,
    version: Option<i32>,
    #[serde(default)]
    character_id: Option<i32>,
}
pub(crate) fn check_agent(b: &AgentForm) -> Result<()> {
    if b.character_id.is_some_and(|c| !(0..12).contains(&c))
        || !valid(&b.name, 100)
        || !valid(&b.role, 200)
        || b.instructions.len() > 20000
        || !matches!(b.provider.as_str(), "codex" | "claude")
        || !(0..20).contains(&b.x)
        || !(0..12).contains(&b.y)
    {
        Err(bad("Invalid agent fields or office coordinates"))
    } else {
        Ok(())
    }
}
pub(crate) async fn agents(
    State(a): State<App>,
    h: HeaderMap,
    Path(wid): Path<Uuid>,
) -> Result<Json<Vec<Value>>> {
    let u = user(&a, &h).await?;
    access(&a, &u, wid, false).await?;
    Ok(Json(sqlx::query_scalar("SELECT row_to_json(a) FROM agents a WHERE workspace_id=$1 AND deleted_at IS NULL ORDER BY created_at").bind(wid).fetch_all(&a.db).await?))
}
pub(crate) async fn create_agent(
    State(a): State<App>,
    h: HeaderMap,
    Path(wid): Path<Uuid>,
    Json(b): Json<AgentForm>,
) -> Result<Json<Value>> {
    let u = user(&a, &h).await?;
    access(&a, &u, wid, true).await?;
    check_agent(&b)?;
    let id = Uuid::new_v4();
    sqlx::query("INSERT INTO agents(id,workspace_id,name,role,instructions,provider,x,y,enabled,character_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)").bind(id).bind(wid).bind(b.name).bind(b.role).bind(b.instructions).bind(b.provider).bind(b.x).bind(b.y).bind(b.enabled).bind(b.character_id.unwrap_or(0)).execute(&a.db).await?;
    audit(&a, &u, Some(wid), "agent.created").await?;
    Ok(Json(json!({"id":id})))
}
pub(crate) async fn edit_agent(
    State(a): State<App>,
    h: HeaderMap,
    Path((wid, id)): Path<(Uuid, Uuid)>,
    Json(b): Json<AgentForm>,
) -> Result<Json<Value>> {
    let u = user(&a, &h).await?;
    access(&a, &u, wid, true).await?;
    check_agent(&b)?;
    let mut tx = a.db.begin().await?;
    organization::lock_workspace(&mut tx, wid).await?;
    let n=sqlx::query("UPDATE agents SET name=$1,role=$2,instructions=$3,provider=$4,x=$5,y=$6,enabled=$7,character_id=coalesce($11,character_id),version=version+1 WHERE id=$8 AND workspace_id=$9 AND version=$10 AND deleted_at IS NULL").bind(b.name).bind(b.role).bind(b.instructions).bind(b.provider).bind(b.x).bind(b.y).bind(b.enabled).bind(id).bind(wid).bind(b.version.ok_or(bad("Version required"))?).bind(b.character_id).execute(&mut *tx).await?.rows_affected();
    tx.commit().await?;
    audit(&a, &u, Some(wid), "agent.updated").await?;
    changed(n)
}
