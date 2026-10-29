use super::*;
use crate::domain::{PlanPolicy, PlanStep};
#[derive(Deserialize)]
pub(super) struct WorkflowForm {
    title: String,
    #[serde(default)]
    description: String,
    steps: Vec<PlanStep>,
    #[serde(default)]
    version: i32,
}
impl WorkflowForm {
    fn validate(&self) -> Result<()> {
        if !valid(&self.title, 160)
            || self.description.len() > 10000
            || !PlanPolicy::validate(&self.steps)
        {
            Err(bad("Workflow requires a title and 1–8 valid ordered steps"))
        } else {
            Ok(())
        }
    }
}
async fn validate_steps(
    tx: &mut Transaction<'_, Postgres>,
    wid: Uuid,
    steps: &[PlanStep],
) -> Result<()> {
    for step in steps {
        if let Some(reviewer) = step.reviewer_id {
            validate_reviewer(tx, wid, reviewer).await?;
        }
        freeze_context(tx, wid, Some(step.agent_id), &step.skill_ids, None).await?;
    }
    Ok(())
}
async fn revision(
    tx: &mut Transaction<'_, Postgres>,
    id: Uuid,
    version: i32,
    b: &WorkflowForm,
) -> Result<()> {
    sqlx::query("INSERT INTO workflow_versions(workflow_id,version,title,description,steps) VALUES($1,$2,$3,$4,$5)").bind(id).bind(version).bind(b.title.trim()).bind(&b.description).bind(json!(b.steps)).execute(&mut **tx).await?;
    Ok(())
}
pub(super) async fn workflows(
    State(a): State<App>,
    h: HeaderMap,
    Path(wid): Path<Uuid>,
) -> Result<Json<Value>> {
    let u = user(&a, &h).await?;
    access(&a, &u, wid, false).await?;
    let rows:Vec<Value>=sqlx::query_scalar("SELECT to_jsonb(v)||jsonb_build_object('id',w.id,'deleted_at',w.deleted_at) FROM workflows w JOIN workflow_versions v ON v.workflow_id=w.id AND v.version=w.version WHERE w.workspace_id=$1 ORDER BY w.created_at").bind(wid).fetch_all(&a.db).await?;
    Ok(Json(json!(rows)))
}
pub(super) async fn create_workflow(
    State(a): State<App>,
    h: HeaderMap,
    Path(wid): Path<Uuid>,
    Json(b): Json<WorkflowForm>,
) -> Result<Json<Value>> {
    let u = user(&a, &h).await?;
    access(&a, &u, wid, true).await?;
    b.validate()?;
    let mut tx = a.db.begin().await?;
    lock_workspace(&mut tx, wid).await?;
    validate_steps(&mut tx, wid, &b.steps).await?;
    let id = Uuid::new_v4();
    sqlx::query("INSERT INTO workflows(id,workspace_id,created_by) VALUES($1,$2,$3)")
        .bind(id)
        .bind(wid)
        .bind(u.id)
        .execute(&mut *tx)
        .await?;
    revision(&mut tx, id, 0, &b).await?;
    tx.commit().await?;
    phase2::audit(&a, &u, Some(wid), "workflow.created").await?;
    Ok(Json(json!({"id":id,"version":0})))
}
pub(super) async fn edit_workflow(
    State(a): State<App>,
    h: HeaderMap,
    Path((wid, id)): Path<(Uuid, Uuid)>,
    Json(b): Json<WorkflowForm>,
) -> Result<Json<Value>> {
    let u = user(&a, &h).await?;
    access(&a, &u, wid, true).await?;
    b.validate()?;
    let mut tx = a.db.begin().await?;
    lock_workspace(&mut tx, wid).await?;
    validate_steps(&mut tx, wid, &b.steps).await?;
    let n=sqlx::query("UPDATE workflows SET version=version+1 WHERE id=$1 AND workspace_id=$2 AND version=$3 AND deleted_at IS NULL").bind(id).bind(wid).bind(b.version).execute(&mut *tx).await?.rows_affected();
    if n == 0 {
        return Err(Error(StatusCode::CONFLICT, "Workflow changed or archived"));
    }
    revision(&mut tx, id, b.version + 1, &b).await?;
    tx.commit().await?;
    phase2::audit(&a, &u, Some(wid), "workflow.revised").await?;
    Ok(Json(json!({"ok":true,"version":b.version+1})))
}
pub(super) async fn workflow_history(
    State(a): State<App>,
    h: HeaderMap,
    Path((wid, id)): Path<(Uuid, Uuid)>,
) -> Result<Json<Value>> {
    let u = user(&a, &h).await?;
    access(&a, &u, wid, false).await?;
    let rows:Vec<Value>=sqlx::query_scalar("SELECT to_jsonb(v) FROM workflow_versions v JOIN workflows w ON w.id=v.workflow_id WHERE w.id=$1 AND w.workspace_id=$2 ORDER BY v.version DESC").bind(id).bind(wid).fetch_all(&a.db).await?;
    if rows.is_empty() {
        return Err(Error(StatusCode::NOT_FOUND, "Workflow not found"));
    }
    Ok(Json(json!(rows)))
}
#[derive(Deserialize)]
pub(super) struct Instantiate {
    version: i32,
    goal: String,
    request_id: Uuid,
}
pub(super) async fn instantiate(
    State(a): State<App>,
    h: HeaderMap,
    Path((wid, id)): Path<(Uuid, Uuid)>,
    Json(b): Json<Instantiate>,
) -> Result<Json<Value>> {
    let u = user(&a, &h).await?;
    access(&a, &u, wid, true).await?;
    if !valid(&b.goal, 20000) {
        return Err(bad("Goal required"));
    }
    let mut tx = a.db.begin().await?;
    lock_workspace(&mut tx, wid).await?;
    // The idempotency key is per user, even when requests target different workspaces.
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))")
        .bind(format!("workflow-launch:{}:{}", u.id, b.request_id))
        .execute(&mut *tx)
        .await?;

    let existing:Option<(Uuid,i32,String,Uuid,Uuid)>=sqlx::query_as("SELECT l.workflow_id,l.workflow_version,l.goal,l.plan_id,p.workspace_id FROM workflow_launches l JOIN plans p ON p.id=l.plan_id WHERE l.user_id=$1 AND l.request_id=$2").bind(u.id).bind(b.request_id).fetch_optional(&mut *tx).await?;
    if let Some((workflow, version, goal, plan, plan_workspace)) = existing {
        if plan_workspace != wid || workflow != id || version != b.version || goal != b.goal {
            return Err(Error(
                StatusCode::CONFLICT,
                "Request ID was already used with different input",
            ));
        }
        return Ok(Json(json!({"plan_id":plan,"replayed":true})));
    }
    let raw:Option<Value>=sqlx::query_scalar("SELECT to_jsonb(v) FROM workflow_versions v JOIN workflows w ON w.id=v.workflow_id WHERE w.id=$1 AND w.workspace_id=$2 AND w.deleted_at IS NULL AND v.version=$3").bind(id).bind(wid).bind(b.version).fetch_optional(&mut *tx).await?;
    let raw = raw.ok_or(Error(
        StatusCode::NOT_FOUND,
        "Active workflow/version not found",
    ))?;
    let steps: Vec<PlanStep> =
        serde_json::from_value(raw["steps"].clone()).map_err(|_| bad("Invalid workflow steps"))?;
    validate_steps(&mut tx, wid, &steps).await?;
    let plan = Uuid::new_v4();
    sqlx::query("INSERT INTO plans(id,workspace_id,created_by,goal,steps,workflow_snapshot) VALUES($1,$2,$3,$4,$5,$6)").bind(plan).bind(wid).bind(u.id).bind(&b.goal).bind(json!(steps)).bind(raw).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO workflow_launches VALUES($1,$2,$3,$4,$5,$6)")
        .bind(u.id)
        .bind(b.request_id)
        .bind(id)
        .bind(b.version)
        .bind(b.goal)
        .bind(plan)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    phase2::audit(&a, &u, Some(wid), "workflow.draft_instantiated").await?;
    Ok(Json(json!({"plan_id":plan,"replayed":false})))
}
async fn archive(a: App, h: HeaderMap, wid: Uuid, id: Uuid, restore: bool) -> Result<Json<Value>> {
    let u = user(&a, &h).await?;
    access(&a, &u, wid, true).await?;
    let mut tx = a.db.begin().await?;
    lock_workspace(&mut tx, wid).await?;
    let n=sqlx::query("UPDATE workflows SET deleted_at=CASE WHEN $3 THEN NULL ELSE now() END WHERE id=$1 AND workspace_id=$2 AND (($3 AND deleted_at IS NOT NULL) OR (NOT $3 AND deleted_at IS NULL))").bind(id).bind(wid).bind(restore).execute(&mut *tx).await?.rows_affected();
    tx.commit().await?;
    phase2::audit(
        &a,
        &u,
        Some(wid),
        if restore {
            "workflow.restored"
        } else {
            "workflow.archived"
        },
    )
    .await?;
    phase2::changed(n)
}
pub(super) async fn delete_workflow(
    State(a): State<App>,
    h: HeaderMap,
    Path((wid, id)): Path<(Uuid, Uuid)>,
) -> Result<Json<Value>> {
    archive(a, h, wid, id, false).await
}
pub(super) async fn restore_workflow(
    State(a): State<App>,
    h: HeaderMap,
    Path((wid, id)): Path<(Uuid, Uuid)>,
) -> Result<Json<Value>> {
    archive(a, h, wid, id, true).await
}
