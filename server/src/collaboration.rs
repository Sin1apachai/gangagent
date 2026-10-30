use super::*;
use axum::routing::put;
use domain::{PlanPolicy, PlanStep};
pub fn routes() -> Router<App> {
    Router::new()
        .route(
            "/workspaces/{wid}/projects",
            get(projects).post(create_project),
        )
        .route(
            "/workspaces/{wid}/projects/{id}",
            put(edit_project).delete(delete_project),
        )
        .route(
            "/workspaces/{wid}/projects/{id}/restore",
            post(restore_project),
        )
        .route("/workspaces/{wid}/plans", get(plans).post(create_plan))
        .route("/workspaces/{wid}/plans/{id}", put(edit_plan))
        .route("/workspaces/{wid}/plans/{id}/import", post(import_plan))
        .route("/workspaces/{wid}/plans/{id}/approve", post(approve_plan))
        .route("/workspaces/{wid}/plans/{id}/cancel", post(cancel_plan))
        .route("/knowledge/search", get(search))
        .route("/admin/intelligence/{id}", put(grant))
        .route(
            "/workspaces/{wid}/tasks/{id}/attachments",
            get(attachments).post(add_attachment),
        )
        .route(
            "/workspaces/{wid}/tasks/{id}/attachments/{aid}",
            get(download_attachment).delete(delete_attachment),
        )
}
#[derive(Deserialize)]
struct ProjectForm {
    working_folder: Option<Value>,
    name: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    version: i32,
}
async fn projects(
    State(a): State<App>,
    h: HeaderMap,
    Path(wid): Path<Uuid>,
) -> Result<Json<Value>> {
    let u = user(&a, &h).await?;
    access(&a, &u, wid, false).await?;
    let rows: Vec<Value> = sqlx::query_scalar(
        "SELECT row_to_json(p) FROM projects p WHERE workspace_id=$1 ORDER BY created_at",
    )
    .bind(wid)
    .fetch_all(&a.db)
    .await?;
    Ok(Json(json!(rows)))
}
async fn create_project(
    State(a): State<App>,
    h: HeaderMap,
    Path(wid): Path<Uuid>,
    Json(b): Json<ProjectForm>,
) -> Result<Json<Value>> {
    let u = user(&a, &h).await?;
    access(&a, &u, wid, true).await?;
    if !valid(&b.name, 100) || b.description.len() > 5000 {
        return Err(bad("Invalid project"));
    }
    let folder = project_files::validate(u.id, b.working_folder.as_ref()).await?;
    let id = Uuid::new_v4();
    sqlx::query("INSERT INTO projects(id,workspace_id,name,description,working_folder) VALUES($1,$2,$3,$4,$5)")
        .bind(id)
        .bind(wid)
        .bind(b.name.trim())
        .bind(b.description)
        .bind(folder)
        .execute(&a.db)
        .await?;
    Ok(Json(json!({"id":id})))
}
async fn edit_project(
    State(a): State<App>,
    h: HeaderMap,
    Path((wid, id)): Path<(Uuid, Uuid)>,
    Json(b): Json<ProjectForm>,
) -> Result<Json<Value>> {
    let u = user(&a, &h).await?;
    access(&a, &u, wid, true).await?;
    if !valid(&b.name, 100) || b.description.len() > 5000 {
        return Err(bad("Invalid project"));
    }
    let old:Option<Value>=sqlx::query_scalar("SELECT working_folder FROM projects WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL").bind(id).bind(wid).fetch_one(&a.db).await?;
    let folder = match b.working_folder.as_ref() {
        Some(f) if Some(f) != old.as_ref() => project_files::validate(u.id, Some(f)).await?,
        Some(_) => old,
        None => old,
    };
    changed(sqlx::query("UPDATE projects SET name=$1,description=$2,working_folder=$6,version=version+1 WHERE id=$3 AND workspace_id=$4 AND version=$5 AND deleted_at IS NULL").bind(b.name.trim()).bind(b.description).bind(id).bind(wid).bind(b.version).bind(folder).execute(&a.db).await?.rows_affected())
}
async fn project_deleted(
    a: &App,
    u: &User,
    wid: Uuid,
    id: Uuid,
    deleted: bool,
) -> Result<Json<Value>> {
    access(a, u, wid, true).await?;
    let n=sqlx::query("UPDATE projects SET deleted_at=CASE WHEN $3 THEN now() ELSE NULL END,version=version+1 WHERE id=$1 AND workspace_id=$2").bind(id).bind(wid).bind(deleted).execute(&a.db).await?.rows_affected();
    changed(n)
}
async fn delete_project(
    State(a): State<App>,
    h: HeaderMap,
    Path((wid, id)): Path<(Uuid, Uuid)>,
) -> Result<Json<Value>> {
    let u = user(&a, &h).await?;
    project_deleted(&a, &u, wid, id, true).await
}
async fn restore_project(
    State(a): State<App>,
    h: HeaderMap,
    Path((wid, id)): Path<(Uuid, Uuid)>,
) -> Result<Json<Value>> {
    let u = user(&a, &h).await?;
    project_deleted(&a, &u, wid, id, false).await
}
fn changed(n: u64) -> Result<Json<Value>> {
    if n == 0 {
        Err(Error(StatusCode::CONFLICT, "Item changed or unavailable"))
    } else {
        Ok(Json(json!({"ok":true})))
    }
}
#[derive(Deserialize)]
struct PlanForm {
    goal: String,
    #[serde(default)]
    steps: Vec<PlanStep>,
    manager_agent_id: Option<Uuid>,
    #[serde(default)]
    version: i32,
}
async fn plans(State(a): State<App>, h: HeaderMap, Path(wid): Path<Uuid>) -> Result<Json<Value>> {
    let u = user(&a, &h).await?;
    access(&a, &u, wid, false).await?;
    let rows: Vec<Value> = sqlx::query_scalar(
        "SELECT row_to_json(p) FROM plans p WHERE workspace_id=$1 ORDER BY created_at DESC",
    )
    .bind(wid)
    .fetch_all(&a.db)
    .await?;
    Ok(Json(json!(rows)))
}
async fn create_plan(
    State(a): State<App>,
    h: HeaderMap,
    Path(wid): Path<Uuid>,
    Json(b): Json<PlanForm>,
) -> Result<Json<Value>> {
    let u = user(&a, &h).await?;
    access(&a, &u, wid, true).await?;
    if !valid(&b.goal, 20000) {
        return Err(bad("Goal required"));
    }
    let planner = if let Some(manager) = b.manager_agent_id {
        let provider:Option<String>=sqlx::query_scalar("SELECT provider FROM agents WHERE id=$1 AND workspace_id=$2 AND enabled AND deleted_at IS NULL").bind(manager).bind(wid).fetch_optional(&a.db).await?;
        let provider = provider.ok_or(bad("Manager agent unavailable"))?;
        let agents:Vec<Value>=sqlx::query_scalar("SELECT json_build_object('id',id,'name',name,'role',role,'provider',provider) FROM agents WHERE workspace_id=$1 AND enabled AND deleted_at IS NULL").bind(wid).fetch_all(&a.db).await?;
        let id = Uuid::new_v4();
        let description=format!("Propose a plan for the following goal. Do not execute the plan. Reply ONLY with a JSON array of 1 to 8 steps. Each object must have title, description, agent_id (from the supplied team) and depends_on (zero-based indexes of earlier steps). Include a review/final summary step. Goal: {}\nTeam: {}",b.goal,json!(agents));
        sqlx::query("INSERT INTO tasks(id,workspace_id,created_by,title,description,provider,agent_id) VALUES($1,$2,$3,'Team plan proposal',$4,$5,$6)").bind(id).bind(wid).bind(u.id).bind(description).bind(provider).bind(manager).execute(&a.db).await?;
        Some(id)
    } else {
        None
    };
    let id = application::PlanService::new(a.db.clone())
        .draft(u.id, wid, &b.goal, b.steps, planner)
        .await?;
    Ok(Json(json!({"id":id,"planner_task_id":planner})))
}
async fn valid_agents(a: &App, wid: Uuid, steps: &[PlanStep]) -> Result<()> {
    if !PlanPolicy::validate(steps) {
        return Err(bad("Plan must have 1–8 ordered steps without cycles"));
    }
    for s in steps {
        let exists:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM agents WHERE id=$1 AND workspace_id=$2 AND enabled AND deleted_at IS NULL)").bind(s.agent_id).bind(wid).fetch_one(&a.db).await?;
        if !exists {
            return Err(bad("Every step needs an enabled agent from this workspace"));
        }
    }
    let mut tx = a.db.begin().await?;
    for step in steps {
        if let Some(reviewer) = step.reviewer_id {
            organization::validate_reviewer(&mut tx, wid, reviewer).await?;
        }
        organization::freeze_context(&mut tx, wid, Some(step.agent_id), &step.skill_ids, None)
            .await?;
    }
    Ok(())
}
async fn edit_plan(
    State(a): State<App>,
    h: HeaderMap,
    Path((wid, id)): Path<(Uuid, Uuid)>,
    Json(b): Json<PlanForm>,
) -> Result<Json<Value>> {
    let u = user(&a, &h).await?;
    access(&a, &u, wid, true).await?;
    valid_agents(&a, wid, &b.steps).await?;
    if !valid(&b.goal, 20000) {
        return Err(bad("Goal required"));
    }
    changed(sqlx::query("UPDATE plans SET goal=$1,steps=$2,version=version+1 WHERE id=$3 AND workspace_id=$4 AND created_by=$5 AND status='draft' AND version=$6").bind(b.goal).bind(json!(b.steps)).bind(id).bind(wid).bind(u.id).bind(b.version).execute(&a.db).await?.rows_affected())
}
async fn import_plan(
    State(a): State<App>,
    h: HeaderMap,
    Path((wid, id)): Path<(Uuid, Uuid)>,
) -> Result<Json<Value>> {
    let u = user(&a, &h).await?;
    access(&a, &u, wid, true).await?;
    let result:Option<String>=sqlx::query_scalar("SELECT t.result FROM plans p JOIN tasks t ON t.id=p.planner_task_id WHERE p.id=$1 AND p.workspace_id=$2 AND p.created_by=$3 AND p.status='draft' AND t.status IN ('review','done') AND t.deleted_at IS NULL").bind(id).bind(wid).bind(u.id).fetch_optional(&a.db).await?;
    let result = result.ok_or(bad("Planner result is not ready"))?;
    let text = result
        .trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();
    let steps: Vec<PlanStep> = serde_json::from_str(text).map_err(|_| {
        bad("Planner must return a valid JSON array; edit the draft manually if needed")
    })?;
    valid_agents(&a, wid, &steps).await?;
    changed(
        sqlx::query("UPDATE plans SET steps=$1,version=version+1 WHERE id=$2 AND status='draft'")
            .bind(json!(steps))
            .bind(id)
            .execute(&a.db)
            .await?
            .rows_affected(),
    )
}
#[derive(Deserialize)]
struct Approval {
    version: i32,
    billing_acknowledged: bool,
    #[serde(default)]
    context_format: Option<String>,
}
async fn approve_plan(
    State(a): State<App>,
    h: HeaderMap,
    Path((wid, id)): Path<(Uuid, Uuid)>,
    Json(b): Json<Approval>,
) -> Result<Json<Value>> {
    let u = user(&a, &h).await?;
    if b.context_format
        .as_ref()
        .is_some_and(|s| !matches!(s.as_str(), "compact" | "pretty" | "focused"))
    {
        return Err(bad("Invalid context format"));
    }
    access(&a, &u, wid, true).await?;
    if !b.billing_acknowledged {
        return Err(bad("Confirm subscription usage"));
    }
    let mut tx = a.db.begin().await?;
    sqlx::query("SELECT id FROM workspaces WHERE id=$1 AND deleted_at IS NULL FOR UPDATE")
        .bind(wid)
        .fetch_one(&mut *tx)
        .await?;
    let raw:Option<Value>=sqlx::query_scalar("SELECT steps FROM plans WHERE id=$1 AND workspace_id=$2 AND created_by=$3 AND status='draft' AND version=$4 FOR UPDATE").bind(id).bind(wid).bind(u.id).bind(b.version).fetch_optional(&mut *tx).await?;
    let raw = raw.ok_or(Error(
        StatusCode::CONFLICT,
        "Plan changed or already started",
    ))?;
    let steps: Vec<PlanStep> = serde_json::from_value(raw).map_err(|_| bad("Invalid steps"))?;
    if !PlanPolicy::validate(&steps) {
        return Err(bad("Invalid plan steps"));
    }
    let mut ids: Vec<Uuid> = Vec::new();
    for step in &steps {
        let provider: String = sqlx::query_scalar("SELECT provider FROM agents WHERE id=$1 AND workspace_id=$2 AND enabled AND deleted_at IS NULL")
            .bind(step.agent_id)
            .bind(wid)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or(bad("Every step needs an enabled agent from this workspace"))?;
        let ready:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM provider_connections WHERE user_id=$1 AND provider=$2 AND enabled AND billing_acknowledged AND NOT reauth_required)").bind(u.id).bind(&provider).fetch_one(&mut *tx).await?;
        if !ready {
            return Err(bad("Enable and connect every provider used by the plan"));
        }
        let tid = Uuid::new_v4();
        let reviewer = step.reviewer_id.unwrap_or(u.id);
        organization::validate_reviewer(&mut tx, wid, reviewer).await?;
        let contract = json!(step);
        let context = organization::freeze_context(
            &mut tx,
            wid,
            Some(step.agent_id),
            &step.skill_ids,
            Some(contract.clone()),
        )
        .await?;
        sqlx::query("INSERT INTO tasks(id,workspace_id,created_by,title,description,provider,agent_id,plan_id,execution_requested,execution_context,reviewer_id,workflow_step,acceptance_criteria,context_format) VALUES($1,$2,$3,$4,$5,$6,$7,$8,true,$9,$10,$11,$12,$13)").bind(tid).bind(wid).bind(u.id).bind(&step.title).bind(&step.description).bind(provider).bind(step.agent_id).bind(id).bind(context).bind(reviewer).bind(contract).bind(&step.acceptance_criteria).bind(b.context_format.as_deref().unwrap_or("compact")).execute(&mut *tx).await?;
        for &parent in &step.depends_on {
            sqlx::query("INSERT INTO task_dependencies VALUES($1,$2)")
                .bind(tid)
                .bind(ids[parent])
                .execute(&mut *tx)
                .await?;
        }
        ids.push(tid);
    }
    sqlx::query("UPDATE plans SET status='approved',version=version+1 WHERE id=$1")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(Json(json!({"tasks":ids})))
}
async fn cancel_plan(
    State(a): State<App>,
    h: HeaderMap,
    Path((wid, id)): Path<(Uuid, Uuid)>,
) -> Result<Json<Value>> {
    let u = user(&a, &h).await?;
    access(&a, &u, wid, true).await?;
    let mut tx = a.db.begin().await?;
    let n=sqlx::query("UPDATE plans SET status='cancelled',version=version+1 WHERE id=$1 AND workspace_id=$2 AND created_by=$3 AND status!='cancelled'").bind(id).bind(wid).bind(u.id).execute(&mut *tx).await?.rows_affected();
    if n > 0 {
        sqlx::query("UPDATE tasks SET execution_requested=false,cancel_requested=cancel_requested OR status='running',version=version+1 WHERE plan_id=$1").bind(id).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    changed(n)
}
#[derive(Deserialize)]
struct Search {
    q: String,
    workspace_id: Option<Uuid>,
    #[serde(default)]
    global: bool,
}
async fn search(
    State(a): State<App>,
    h: HeaderMap,
    axum::extract::Query(b): axum::extract::Query<Search>,
) -> Result<Json<Value>> {
    let u = user(&a, &h).await?;
    if !valid(&b.q, 500) {
        return Err(bad("Search query required"));
    }
    if b.global {
        let grant: bool =
            sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM intelligence_grants WHERE user_id=$1)")
                .bind(u.id)
                .fetch_one(&a.db)
                .await?;
        if !u.is_super_admin && !grant {
            return Err(Error(
                StatusCode::FORBIDDEN,
                "Global intelligence access required",
            ));
        }
    } else {
        access(
            &a,
            &u,
            b.workspace_id.ok_or(bad("Workspace required"))?,
            false,
        )
        .await?;
    }
    let rows:Vec<Value>=sqlx::query_scalar("SELECT json_build_object('id',k.id,'title',k.title,'content',k.content,'source',k.source,'workspace_id',w.id,'workspace_name',w.name,'verified',k.verified,'rank',ts_rank(to_tsvector('simple',k.title||' '||k.content),websearch_to_tsquery('simple',$1))) FROM knowledge k JOIN workspaces w ON w.id=k.workspace_id WHERE k.deleted_at IS NULL AND w.deleted_at IS NULL AND k.verified AND ($2 OR k.workspace_id=$3) AND (to_tsvector('simple',k.title||' '||k.content)@@websearch_to_tsquery('simple',$1) OR (k.title||' '||k.content) ILIKE '%'||$1||'%') ORDER BY ts_rank(to_tsvector('simple',k.title||' '||k.content),websearch_to_tsquery('simple',$1)) DESC LIMIT 30").bind(&b.q).bind(b.global).bind(b.workspace_id).fetch_all(&a.db).await?;
    let semantic = infrastructure::semantic::search(&a.db, &b.q, b.global, b.workspace_id).await;
    let (rows, method) = if let Some(mut semantic) = semantic {
        for row in rows {
            if !semantic.iter().any(|r| r["id"] == row["id"]) {
                semantic.push(row);
            }
        }
        (semantic, "local_multilingual_semantic+postgres_full_text")
    } else {
        (rows, "postgres_full_text")
    };
    sqlx::query("INSERT INTO audit_events(user_id,workspace_id,action) VALUES($1,$2,$3)")
        .bind(u.id)
        .bind(if b.global { None } else { b.workspace_id })
        .bind(if b.global {
            "intelligence.global_search"
        } else {
            "knowledge.search"
        })
        .execute(&a.db)
        .await?;
    Ok(Json(
        json!({"results":rows,"method":method,"global":b.global}),
    ))
}
#[derive(Deserialize)]
struct Grant {
    enabled: bool,
}
async fn grant(
    State(a): State<App>,
    h: HeaderMap,
    Path(id): Path<Uuid>,
    Json(b): Json<Grant>,
) -> Result<Json<Value>> {
    let u = user(&a, &h).await?;
    if !u.is_super_admin {
        return Err(Error(StatusCode::FORBIDDEN, "Super admin required"));
    }
    if b.enabled {
        sqlx::query("INSERT INTO intelligence_grants(user_id,granted_by) SELECT id,$2 FROM users WHERE id=$1 AND deleted_at IS NULL ON CONFLICT(user_id) DO NOTHING").bind(id).bind(u.id).execute(&a.db).await?;
    } else {
        sqlx::query("DELETE FROM intelligence_grants WHERE user_id=$1")
            .bind(id)
            .execute(&a.db)
            .await?;
    }
    sqlx::query("INSERT INTO audit_events(user_id,action) VALUES($1,$2)")
        .bind(u.id)
        .bind(format!("intelligence.grant.{id}.{}", b.enabled))
        .execute(&a.db)
        .await?;
    Ok(Json(json!({"ok":true})))
}
async fn attachments(
    State(a): State<App>,
    h: HeaderMap,
    Path((wid, id)): Path<(Uuid, Uuid)>,
) -> Result<Json<Value>> {
    let u = user(&a, &h).await?;
    access(&a, &u, wid, false).await?;
    let rows:Vec<Value>=sqlx::query_scalar("SELECT json_build_object('id',f.id,'name',f.name,'size',octet_length(f.data)) FROM task_attachments f JOIN tasks t ON t.id=f.task_id WHERE t.id=$1 AND t.workspace_id=$2 AND t.deleted_at IS NULL AND f.deleted_at IS NULL ORDER BY f.created_at").bind(id).bind(wid).fetch_all(&a.db).await?;
    Ok(Json(json!(rows)))
}
#[derive(Deserialize)]
struct Upload {
    name: String,
    data: Vec<u8>,
}
async fn add_attachment(
    State(a): State<App>,
    h: HeaderMap,
    Path((wid, id)): Path<(Uuid, Uuid)>,
    Json(b): Json<Upload>,
) -> Result<Json<Value>> {
    let u = user(&a, &h).await?;
    access(&a, &u, wid, true).await?;
    if !valid(&b.name, 150)
        || b.name.contains(['/', '\\'])
        || b.name.starts_with('.')
        || b.data.len() > 1048576
    {
        return Err(bad("File name invalid or file exceeds 1 MiB"));
    }
    let mut tx = a.db.begin().await?;
    let task:Option<Uuid>=sqlx::query_scalar("SELECT id FROM tasks WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL AND status!='running' AND NOT execution_requested FOR UPDATE").bind(id).bind(wid).fetch_optional(&mut *tx).await?;
    if task.is_none() {
        return Err(Error(
            StatusCode::CONFLICT,
            "Task unavailable for attachment changes",
        ));
    }
    let count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM task_attachments WHERE task_id=$1 AND deleted_at IS NULL",
    )
    .bind(id)
    .fetch_one(&mut *tx)
    .await?;
    if count >= 5 {
        return Err(bad("Maximum five reference files per task"));
    }
    let aid = Uuid::new_v4();
    sqlx::query("INSERT INTO task_attachments(id,task_id,name,data) VALUES($1,$2,$3,$4)")
        .bind(aid)
        .bind(id)
        .bind(b.name)
        .bind(b.data)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(Json(json!({"id":aid})))
}
async fn delete_attachment(
    State(a): State<App>,
    h: HeaderMap,
    Path((wid, id, aid)): Path<(Uuid, Uuid, Uuid)>,
) -> Result<Json<Value>> {
    let u = user(&a, &h).await?;
    access(&a, &u, wid, true).await?;
    changed(sqlx::query("UPDATE task_attachments f SET deleted_at=now() FROM tasks t WHERE f.task_id=t.id AND t.id=$1 AND t.workspace_id=$2 AND f.id=$3 AND t.deleted_at IS NULL AND t.status!='running' AND NOT t.execution_requested AND f.deleted_at IS NULL").bind(id).bind(wid).bind(aid).execute(&a.db).await?.rows_affected())
}
async fn download_attachment(
    State(a): State<App>,
    h: HeaderMap,
    Path((wid, id, aid)): Path<(Uuid, Uuid, Uuid)>,
) -> Result<Response> {
    let u = user(&a, &h).await?;
    access(&a, &u, wid, false).await?;
    let data:Option<Vec<u8>>=sqlx::query_scalar("SELECT f.data FROM task_attachments f JOIN tasks t ON t.id=f.task_id WHERE t.id=$1 AND t.workspace_id=$2 AND f.id=$3 AND t.deleted_at IS NULL AND f.deleted_at IS NULL").bind(id).bind(wid).bind(aid).fetch_optional(&a.db).await?;
    let data = data.ok_or(Error(StatusCode::NOT_FOUND, "Reference file not found"))?;
    Ok((
        [
            (header::CONTENT_TYPE, "application/octet-stream"),
            (
                header::CONTENT_DISPOSITION,
                "attachment; filename=reference.bin",
            ),
        ],
        data,
    )
        .into_response())
}
