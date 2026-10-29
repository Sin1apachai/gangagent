use super::*;
#[derive(Deserialize)]
pub(super) struct SkillForm {
    title: String,
    #[serde(default)]
    description: String,
    instructions: String,
    #[serde(default)]
    input_contract: String,
    #[serde(default)]
    output_contract: String,
    #[serde(default)]
    acceptance_criteria: String,
    #[serde(default)]
    version: i32,
}
impl SkillForm {
    fn validate(&self) -> Result<()> {
        if !valid(&self.title, 120)
            || !valid(&self.instructions, 10000)
            || self.description.len() > 2000
            || self.input_contract.len() > 3000
            || self.output_contract.len() > 3000
            || self.acceptance_criteria.len() > 3000
        {
            Err(bad("Skill needs a title/instructions within field limits"))
        } else {
            Ok(())
        }
    }
}
async fn revision(
    tx: &mut Transaction<'_, Postgres>,
    id: Uuid,
    version: i32,
    b: &SkillForm,
) -> Result<()> {
    sqlx::query("INSERT INTO skill_versions(skill_id,version,title,description,instructions,input_contract,output_contract,acceptance_criteria) VALUES($1,$2,$3,$4,$5,$6,$7,$8)").bind(id).bind(version).bind(b.title.trim()).bind(&b.description).bind(&b.instructions).bind(&b.input_contract).bind(&b.output_contract).bind(&b.acceptance_criteria).execute(&mut **tx).await?;
    Ok(())
}
pub(super) async fn skills(
    State(a): State<App>,
    h: HeaderMap,
    Path(wid): Path<Uuid>,
) -> Result<Json<Value>> {
    let u = user(&a, &h).await?;
    access(&a, &u, wid, false).await?;
    let rows:Vec<Value>=sqlx::query_scalar("SELECT to_jsonb(v)||jsonb_build_object('id',s.id,'deleted_at',s.deleted_at,'created_by',s.created_by) FROM skills s JOIN skill_versions v ON v.skill_id=s.id AND v.version=s.version WHERE s.workspace_id=$1 ORDER BY s.created_at").bind(wid).fetch_all(&a.db).await?;
    Ok(Json(json!(rows)))
}
pub(super) async fn create_skill(
    State(a): State<App>,
    h: HeaderMap,
    Path(wid): Path<Uuid>,
    Json(b): Json<SkillForm>,
) -> Result<Json<Value>> {
    let u = user(&a, &h).await?;
    access(&a, &u, wid, true).await?;
    b.validate()?;
    let mut tx = a.db.begin().await?;
    lock_workspace(&mut tx, wid).await?;
    let id = Uuid::new_v4();
    sqlx::query("INSERT INTO skills(id,workspace_id,created_by) VALUES($1,$2,$3)")
        .bind(id)
        .bind(wid)
        .bind(u.id)
        .execute(&mut *tx)
        .await?;
    revision(&mut tx, id, 0, &b).await?;
    tx.commit().await?;
    phase2::audit(&a, &u, Some(wid), "skill.created").await?;
    Ok(Json(json!({"id":id,"version":0})))
}
pub(super) async fn edit_skill(
    State(a): State<App>,
    h: HeaderMap,
    Path((wid, id)): Path<(Uuid, Uuid)>,
    Json(b): Json<SkillForm>,
) -> Result<Json<Value>> {
    let u = user(&a, &h).await?;
    access(&a, &u, wid, true).await?;
    b.validate()?;
    let mut tx = a.db.begin().await?;
    lock_workspace(&mut tx, wid).await?;
    let n=sqlx::query("UPDATE skills SET version=version+1 WHERE id=$1 AND workspace_id=$2 AND version=$3 AND deleted_at IS NULL").bind(id).bind(wid).bind(b.version).execute(&mut *tx).await?.rows_affected();
    if n == 0 {
        return Err(Error(StatusCode::CONFLICT, "Skill changed or archived"));
    }
    revision(&mut tx, id, b.version + 1, &b).await?;
    tx.commit().await?;
    phase2::audit(&a, &u, Some(wid), "skill.revised").await?;
    Ok(Json(json!({"ok":true,"version":b.version+1})))
}
pub(super) async fn skill_history(
    State(a): State<App>,
    h: HeaderMap,
    Path((wid, id)): Path<(Uuid, Uuid)>,
) -> Result<Json<Value>> {
    let u = user(&a, &h).await?;
    access(&a, &u, wid, false).await?;
    let rows:Vec<Value>=sqlx::query_scalar("SELECT to_jsonb(v) FROM skill_versions v JOIN skills s ON s.id=v.skill_id WHERE s.workspace_id=$1 AND s.id=$2 ORDER BY v.version DESC").bind(wid).bind(id).fetch_all(&a.db).await?;
    if rows.is_empty() {
        return Err(Error(StatusCode::NOT_FOUND, "Skill not found"));
    }
    Ok(Json(json!(rows)))
}
async fn archive(a: App, h: HeaderMap, wid: Uuid, id: Uuid, restore: bool) -> Result<Json<Value>> {
    let u = user(&a, &h).await?;
    access(&a, &u, wid, true).await?;
    let mut tx = a.db.begin().await?;
    lock_workspace(&mut tx, wid).await?;
    let n=sqlx::query("UPDATE skills SET deleted_at=CASE WHEN $3 THEN NULL ELSE now() END WHERE id=$1 AND workspace_id=$2 AND (($3 AND deleted_at IS NOT NULL) OR (NOT $3 AND deleted_at IS NULL))").bind(id).bind(wid).bind(restore).execute(&mut *tx).await?.rows_affected();
    tx.commit().await?;
    phase2::audit(
        &a,
        &u,
        Some(wid),
        if restore {
            "skill.restored"
        } else {
            "skill.archived"
        },
    )
    .await?;
    phase2::changed(n)
}
pub(super) async fn delete_skill(
    State(a): State<App>,
    h: HeaderMap,
    Path((wid, id)): Path<(Uuid, Uuid)>,
) -> Result<Json<Value>> {
    archive(a, h, wid, id, false).await
}
pub(super) async fn restore_skill(
    State(a): State<App>,
    h: HeaderMap,
    Path((wid, id)): Path<(Uuid, Uuid)>,
) -> Result<Json<Value>> {
    archive(a, h, wid, id, true).await
}
