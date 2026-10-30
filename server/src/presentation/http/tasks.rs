use super::*;
#[derive(Deserialize)]
pub struct TaskForm {
    #[serde(default)]
    pub context_format: Option<String>,
    pub title: String,
    pub description: String,
    pub provider: String,
    pub agent_id: Option<Uuid>,
    pub version: Option<i32>,
    pub project_id: Option<Uuid>,
    #[serde(default = "normal_priority")]
    pub priority: String,
    #[serde(default)]
    pub acceptance_criteria: String,
}
fn normal_priority() -> String {
    "normal".into()
}
pub(crate) async fn check_task(a: &App, wid: Uuid, b: &TaskForm) -> Result<()> {
    if b.context_format
        .as_ref()
        .is_some_and(|v| !matches!(v.as_str(), "compact" | "pretty" | "focused"))
    {
        return Err(bad("Invalid context format"));
    }
    if !valid(&b.title, 200)
        || b.description.len() > 20000
        || !matches!(b.provider.as_str(), "codex" | "claude")
    {
        return Err(bad("Invalid task fields"));
    }
    if !matches!(b.priority.as_str(), "low" | "normal" | "high" | "urgent")
        || b.acceptance_criteria.len() > 10000
    {
        return Err(bad("Invalid priority or acceptance criteria"));
    }
    if let Some(id) = b.project_id {
        let exists:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM projects WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL)").bind(id).bind(wid).fetch_one(&a.db).await?;
        if !exists {
            return Err(bad("Project must be active and in this workspace"));
        }
    }
    if let Some(id) = b.agent_id {
        let ok:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM agents WHERE id=$1 AND workspace_id=$2 AND provider=$3 AND deleted_at IS NULL AND enabled)").bind(id).bind(wid).bind(&b.provider).fetch_one(&a.db).await?;
        if !ok {
            return Err(bad(
                "Agent must be enabled, in this workspace, and use the selected provider",
            ));
        }
    }
    Ok(())
}
pub(crate) async fn create_task(
    State(a): State<App>,
    h: HeaderMap,
    Path(wid): Path<Uuid>,
    Json(b): Json<TaskForm>,
) -> Result<Json<Value>> {
    let u = user(&a, &h).await?;
    access(&a, &u, wid, true).await?;
    check_task(&a, wid, &b).await?;
    let id = Uuid::new_v4();
    sqlx::query("INSERT INTO tasks(id,workspace_id,title,description,provider,agent_id,created_by,project_id,priority,acceptance_criteria,context_format) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)").bind(id).bind(wid).bind(b.title.trim()).bind(b.description).bind(b.provider).bind(b.agent_id).bind(u.id).bind(b.project_id).bind(b.priority).bind(b.acceptance_criteria).bind(b.context_format.unwrap_or_else(||"compact".into())).execute(&a.db).await?;
    audit(&a, &u, Some(wid), "task.created").await?;
    Ok(Json(json!({"id":id,"status":"queued"})))
}
pub(crate) async fn edit_task(
    State(a): State<App>,
    h: HeaderMap,
    Path((wid, id)): Path<(Uuid, Uuid)>,
    Json(b): Json<TaskForm>,
) -> Result<Json<Value>> {
    let u = user(&a, &h).await?;
    access(&a, &u, wid, true).await?;
    check_task(&a, wid, &b).await?;
    let n=sqlx::query("UPDATE tasks SET title=$1,description=$2,provider=$3,agent_id=$4,project_id=$8,priority=$9,acceptance_criteria=$10,version=version+1 WHERE id=$5 AND workspace_id=$6 AND version=$7 AND deleted_at IS NULL AND status!='running' AND NOT execution_requested AND workflow_step IS NULL AND (execution_context IS NULL OR (provider=$3 AND agent_id IS NOT DISTINCT FROM $4))").bind(b.title.trim()).bind(b.description).bind(b.provider).bind(b.agent_id).bind(id).bind(wid).bind(b.version.ok_or(bad("Version required"))?).bind(b.project_id).bind(b.priority).bind(b.acceptance_criteria).execute(&a.db).await?.rows_affected();
    audit(&a, &u, Some(wid), "task.updated").await?;
    changed(n)
}
pub(crate) async fn task_detail(
    State(a): State<App>,
    h: HeaderMap,
    Path((wid, id)): Path<(Uuid, Uuid)>,
) -> Result<Json<Value>> {
    let u = user(&a, &h).await?;
    access(&a, &u, wid, false).await?;
    let v=sqlx::query_scalar("SELECT json_build_object('task',row_to_json(t),'events',COALESCE((SELECT json_agg(e ORDER BY e.id) FROM task_events e WHERE task_id=t.id),'[]'::json),'runs',COALESCE((SELECT json_agg(json_build_object('id',r.id,'status',r.status,'started_at',r.started_at,'finished_at',r.finished_at,'usage_metrics',r.usage_metrics,'result',r.result,'error',r.error) ORDER BY started_at DESC) FROM task_runs r WHERE task_id=t.id),'[]'::json),'artifacts',COALESCE((SELECT json_agg(a) FROM artifacts a WHERE task_id=t.id),'[]'::json)) FROM tasks t WHERE workspace_id=$1 AND id=$2 AND deleted_at IS NULL").bind(wid).bind(id).fetch_optional(&a.db).await?.ok_or(Error(StatusCode::NOT_FOUND,"Task not found"))?;
    Ok(Json(v))
}
#[derive(Deserialize)]
pub(crate) struct RunInput {
    billing_acknowledged: bool,
}
pub(crate) async fn run_task(
    State(a): State<App>,
    h: HeaderMap,
    Path((wid, id)): Path<(Uuid, Uuid)>,
    Json(b): Json<RunInput>,
) -> Result<Json<Value>> {
    let u = user(&a, &h).await?;
    access(&a, &u, wid, true).await?;
    if !b.billing_acknowledged {
        return Err(bad("Confirm subscription billing settings first"));
    }
    let mut tx = a.db.begin().await?;
    sqlx::query("SELECT id FROM workspaces WHERE id=$1 AND deleted_at IS NULL FOR UPDATE")
        .bind(wid)
        .fetch_one(&mut *tx)
        .await?;
    let n=sqlx::query("UPDATE tasks t SET status='queued',execution_requested=true,cancel_requested=false,error='',next_quota_check_at=NULL,version=version+1 WHERE workspace_id=$1 AND id=$2 AND created_by=$3 AND deleted_at IS NULL AND status IN ('queued','failed','cancelled','waiting_auth','waiting_quota','interrupted') AND NOT execution_requested AND attempts<3 AND (t.agent_id IS NULL OR EXISTS(SELECT 1 FROM agents a WHERE a.id=t.agent_id AND a.workspace_id=t.workspace_id AND a.provider=t.provider AND a.enabled AND a.deleted_at IS NULL)) AND EXISTS(SELECT 1 FROM provider_connections c WHERE c.user_id=$3 AND c.provider=t.provider AND c.enabled AND c.billing_acknowledged)").bind(wid).bind(id).bind(u.id).execute(&mut *tx).await?.rows_affected();
    if n > 0 {
        let (agent, context): (Option<Uuid>, Option<Value>) =
            sqlx::query_as("SELECT agent_id,execution_context FROM tasks WHERE id=$1 FOR UPDATE")
                .bind(id)
                .fetch_one(&mut *tx)
                .await?;
        if context.is_none() {
            let mut context = organization::freeze_context(&mut tx, wid, agent, &[], None).await?;
            project_files::freeze(&mut tx, wid, id, u.id, &mut context).await?;
            sqlx::query("UPDATE tasks SET execution_context=$1 WHERE id=$2")
                .bind(context)
                .bind(id)
                .execute(&mut *tx)
                .await?;
        }
    }
    tx.commit().await?;
    if n == 0 {
        return Err(Error(StatusCode::CONFLICT,"Enable your provider connection, check billing acknowledgement, task ownership/state, and the three-attempt limit"));
    }
    audit(&a, &u, Some(wid), "task.execution_requested").await?;
    changed(n)
}
pub(crate) async fn cancel_task(
    State(a): State<App>,
    h: HeaderMap,
    Path((wid, id)): Path<(Uuid, Uuid)>,
) -> Result<Json<Value>> {
    let u = user(&a, &h).await?;
    access(&a, &u, wid, true).await?;
    let n=sqlx::query("UPDATE tasks SET cancel_requested=(status='running'),status=CASE WHEN status='running' THEN status ELSE 'cancelled' END,execution_requested=false,version=version+1 WHERE workspace_id=$1 AND id=$2 AND deleted_at IS NULL AND status IN ('queued','running','waiting_auth','waiting_quota','interrupted')").bind(wid).bind(id).execute(&a.db).await?.rows_affected();
    audit(&a, &u, Some(wid), "task.cancel_requested").await?;
    changed(n)
}
#[derive(Deserialize)]
pub(crate) struct Review {
    accept: bool,
    feedback: String,
}
pub(crate) async fn review_task(
    State(a): State<App>,
    h: HeaderMap,
    Path((wid, id)): Path<(Uuid, Uuid)>,
    Json(b): Json<Review>,
) -> Result<Json<Value>> {
    let u = user(&a, &h).await?;
    access(&a, &u, wid, true).await?;
    if b.feedback.len() > 10000 || (!b.accept && !valid(&b.feedback, 10000)) {
        return Err(bad("Feedback is required for revisions (max 10000 bytes)"));
    }
    let mut tx = a.db.begin().await?;
    let assigned:Option<Option<Uuid>>=sqlx::query_scalar("SELECT reviewer_id FROM tasks WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL FOR UPDATE").bind(id).bind(wid).fetch_optional(&mut *tx).await?;
    if let Some(Some(reviewer)) = assigned {
        if reviewer != u.id && !u.is_super_admin {
            let owner:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM memberships WHERE workspace_id=$1 AND user_id=$2 AND role='owner')").bind(wid).bind(u.id).fetch_one(&mut *tx).await?;
            if !owner {
                return Err(Error(
                    StatusCode::FORBIDDEN,
                    "Only the assigned reviewer or workspace owner can review this workflow task",
                ));
            }
        }
    }
    let n=sqlx::query("UPDATE tasks SET status=$1,review_feedback=$2,execution_requested=false,version=version+1 WHERE workspace_id=$3 AND id=$4 AND status='review' AND deleted_at IS NULL AND ($1='done' OR attempts<3)").bind(if b.accept{"done"}else{"queued"}).bind(&b.feedback).bind(wid).bind(id).execute(&mut *tx).await?.rows_affected();
    tx.commit().await?;
    if n > 0 {
        audit(&a, &u, Some(wid), "task.reviewed").await?;
    }
    if n > 0 {
        event(
            &a.db,
            id,
            None,
            if b.accept {
                "User accepted the result"
            } else {
                "User requested revisions; explicit start required"
            },
        )
        .await?;
    }
    changed(n)
}
pub(crate) async fn event(
    db: &PgPool,
    id: Uuid,
    run: Option<Uuid>,
    msg: &str,
) -> std::result::Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO task_events(task_id,run_id,message) VALUES($1,$2,$3)")
        .bind(id)
        .bind(run)
        .bind(msg)
        .execute(db)
        .await?;
    Ok(())
}
