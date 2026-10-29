use super::*;
use sqlx::{Postgres, Transaction};
mod context;
mod skills;
mod workflows;
pub(crate) use context::{freeze_context, validate_reviewer};
use skills::*;
use workflows::*;
pub fn routes() -> Router<App> {
    Router::new()
        .route("/workspaces/{wid}/skills", get(skills).post(create_skill))
        .route(
            "/workspaces/{wid}/skills/{id}",
            get(skill_history).put(edit_skill).delete(delete_skill),
        )
        .route("/workspaces/{wid}/skills/{id}/restore", post(restore_skill))
        .route("/workspaces/{wid}/organization", get(organization))
        .route(
            "/workspaces/{wid}/agents/{id}/organization",
            axum::routing::put(save_organization),
        )
        .route("/workspaces/{wid}/reviewers", get(reviewers))
        .route(
            "/workspaces/{wid}/tasks/{id}/reviewer",
            axum::routing::put(reassign_reviewer),
        )
        .route(
            "/workspaces/{wid}/workflows",
            get(workflows).post(create_workflow),
        )
        .route(
            "/workspaces/{wid}/workflows/{id}",
            get(workflow_history)
                .put(edit_workflow)
                .delete(delete_workflow),
        )
        .route(
            "/workspaces/{wid}/workflows/{id}/restore",
            post(restore_workflow),
        )
        .route(
            "/workspaces/{wid}/workflows/{id}/instantiate",
            post(instantiate),
        )
}
pub(crate) async fn lock_workspace(tx: &mut Transaction<'_, Postgres>, wid: Uuid) -> Result<()> {
    let found: Option<Uuid> = sqlx::query_scalar(
        "SELECT id FROM workspaces WHERE id=$1 AND deleted_at IS NULL FOR UPDATE",
    )
    .bind(wid)
    .fetch_optional(&mut **tx)
    .await?;
    found.ok_or(Error(StatusCode::NOT_FOUND, "Workspace not found"))?;
    Ok(())
}
async fn organization(
    State(a): State<App>,
    h: HeaderMap,
    Path(wid): Path<Uuid>,
) -> Result<Json<Value>> {
    let u = user(&a, &h).await?;
    access(&a, &u, wid, false).await?;
    let agents:Vec<Value>=sqlx::query_scalar("SELECT row_to_json(a) FROM agents a WHERE workspace_id=$1 AND deleted_at IS NULL ORDER BY created_at").bind(wid).fetch_all(&a.db).await?;
    let bindings:Vec<Value>=sqlx::query_scalar("SELECT json_build_object('agent_id',b.agent_id,'skill_id',b.skill_id,'pinned_version',b.pinned_version,'title',v.title,'current_version',s.version,'deleted',s.deleted_at IS NOT NULL) FROM agent_skills b JOIN agents a ON a.id=b.agent_id JOIN skills s ON s.id=b.skill_id JOIN skill_versions v ON v.skill_id=s.id AND v.version=coalesce(b.pinned_version,s.version) WHERE a.workspace_id=$1 AND a.deleted_at IS NULL AND s.workspace_id=$1").bind(wid).fetch_all(&a.db).await?;
    Ok(Json(json!({"agents":agents,"bindings":bindings})))
}
#[derive(Deserialize)]
struct Binding {
    skill_id: Uuid,
    pinned_version: Option<i32>,
}
#[derive(Deserialize)]
struct OrgForm {
    version: i32,
    manager_id: Option<Uuid>,
    #[serde(default)]
    department: String,
    #[serde(default)]
    responsibilities: String,
    #[serde(default)]
    decision_scope: String,
    #[serde(default)]
    skills: Vec<Binding>,
}
async fn save_organization(
    State(a): State<App>,
    h: HeaderMap,
    Path((wid, id)): Path<(Uuid, Uuid)>,
    Json(b): Json<OrgForm>,
) -> Result<Json<Value>> {
    let u = user(&a, &h).await?;
    access(&a, &u, wid, true).await?;
    phase2::owner(&a, &u, wid).await?;
    if b.department.len() > 100
        || b.responsibilities.len() > 10000
        || b.decision_scope.len() > 5000
        || b.skills.len() > 8
    {
        return Err(bad("Organization fields or skill budget exceeded"));
    }
    let mut tx = a.db.begin().await?;
    lock_workspace(&mut tx, wid).await?;
    if let Some(manager) = b.manager_id {
        let exists:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM agents WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL)").bind(manager).bind(wid).fetch_one(&mut *tx).await?;
        let cycle:bool=sqlx::query_scalar("WITH RECURSIVE ancestors AS(SELECT id,manager_id,ARRAY[id] path FROM agents WHERE id=$1 AND workspace_id=$2 UNION ALL SELECT a.id,a.manager_id,p.path||a.id FROM agents a JOIN ancestors p ON a.id=p.manager_id WHERE a.workspace_id=$2 AND NOT a.id=ANY(p.path)) SELECT EXISTS(SELECT 1 FROM ancestors WHERE id=$3)").bind(manager).bind(wid).bind(id).fetch_one(&mut *tx).await?;
        if !exists || cycle {
            return Err(bad(
                "Manager must belong to this workspace; reporting cycles are forbidden",
            ));
        }
    }
    let mut seen = std::collections::HashSet::new();
    for bind in &b.skills {
        if !seen.insert(bind.skill_id) {
            return Err(bad("Duplicate skill binding"));
        }
        let exists:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM skills s JOIN skill_versions v ON v.skill_id=s.id AND v.version=coalesce($3,s.version) WHERE s.id=$1 AND s.workspace_id=$2 AND s.deleted_at IS NULL)").bind(bind.skill_id).bind(wid).bind(bind.pinned_version).fetch_one(&mut *tx).await?;
        if !exists {
            return Err(bad("Skill/version must be active in this workspace"));
        }
    }
    let n=sqlx::query("UPDATE agents SET manager_id=$1,department=$2,responsibilities=$3,decision_scope=$4,version=version+1 WHERE id=$5 AND workspace_id=$6 AND version=$7 AND deleted_at IS NULL").bind(b.manager_id).bind(b.department.trim()).bind(b.responsibilities).bind(b.decision_scope).bind(id).bind(wid).bind(b.version).execute(&mut *tx).await?.rows_affected();
    if n == 0 {
        return Err(Error(
            StatusCode::CONFLICT,
            "Agent changed; refresh before saving",
        ));
    }
    sqlx::query("DELETE FROM agent_skills WHERE agent_id=$1")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    for bind in b.skills {
        sqlx::query("INSERT INTO agent_skills VALUES($1,$2,$3)")
            .bind(id)
            .bind(bind.skill_id)
            .bind(bind.pinned_version)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    phase2::audit(&a, &u, Some(wid), "organization.updated").await?;
    Ok(Json(json!({"ok":true})))
}
async fn reviewers(
    State(a): State<App>,
    h: HeaderMap,
    Path(wid): Path<Uuid>,
) -> Result<Json<Value>> {
    let u = user(&a, &h).await?;
    access(&a, &u, wid, false).await?;
    let rows:Vec<Value>=sqlx::query_scalar("SELECT json_build_object('id',u.id,'name',u.name) FROM users u WHERE u.deleted_at IS NULL AND (EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=u.id AND m.workspace_id=$1 AND m.role IN ('owner','member')) OR (u.id=$2 AND $3)) ORDER BY u.name").bind(wid).bind(u.id).bind(u.is_super_admin).fetch_all(&a.db).await?;
    Ok(Json(json!(rows)))
}
#[derive(Deserialize)]
struct ReviewerForm {
    version: i32,
    reviewer_id: Option<Uuid>,
}
async fn reassign_reviewer(
    State(a): State<App>,
    h: HeaderMap,
    Path((wid, id)): Path<(Uuid, Uuid)>,
    Json(b): Json<ReviewerForm>,
) -> Result<Json<Value>> {
    let u = user(&a, &h).await?;
    access(&a, &u, wid, true).await?;
    phase2::owner(&a, &u, wid).await?;
    let mut tx = a.db.begin().await?;
    lock_workspace(&mut tx, wid).await?;
    if let Some(reviewer) = b.reviewer_id {
        validate_reviewer(&mut tx, wid, reviewer).await?;
    }
    let n=sqlx::query("UPDATE tasks SET reviewer_id=$1,version=version+1 WHERE id=$2 AND workspace_id=$3 AND version=$4 AND deleted_at IS NULL AND status!='done'").bind(b.reviewer_id).bind(id).bind(wid).bind(b.version).execute(&mut *tx).await?.rows_affected();
    if n == 0 {
        return Err(Error(StatusCode::CONFLICT, "Task changed or completed"));
    }
    tx.commit().await?;
    phase2::event(
        &a.db,
        id,
        None,
        "Workspace owner reassigned the human reviewer",
    )
    .await?;
    phase2::audit(&a, &u, Some(wid), "task.reviewer_reassigned").await?;
    Ok(Json(json!({"ok":true})))
}
