#[path = "presentation/http/workspaces.rs"]
mod workspaces;
pub(crate) use workspaces::*;
#[path = "presentation/http/tasks.rs"]
mod tasks;
pub(crate) use tasks::*;
#[path = "presentation/http/knowledge.rs"]
mod knowledge;
pub(crate) use knowledge::*;
#[path = "presentation/http/agents.rs"]
mod agents;
pub(crate) use agents::*;
#[path = "presentation/http/trash.rs"]
mod trash;
pub(crate) use trash::*;
#[path = "presentation/http/connections.rs"]
mod connections;
pub(crate) use connections::*;
#[path = "presentation/http/accounts.rs"]
mod accounts;
pub(crate) use accounts::*;
#[path = "presentation/http/memberships.rs"]
mod memberships;
pub(crate) use memberships::*;
#[path = "presentation/http/artifacts.rs"]
mod artifacts;
use super::*;
pub(crate) use artifacts::*;
use axum::{
    body::Body,
    routing::{delete, put},
};
use std::path::{Component, Path as FsPath};

pub fn routes() -> Router<App> {
    Router::new()
        .route(
            "/workspaces/{wid}",
            put(rename_workspace).delete(delete_workspace),
        )
        .route("/workspaces/{wid}/restore", post(restore_workspace))
        .route("/workspaces/{wid}/tasks", post(create_task))
        .route(
            "/workspaces/{wid}/tasks/{id}",
            get(task_detail).put(edit_task).delete(delete_task),
        )
        .route("/workspaces/{wid}/tasks/{id}/restore", post(restore_task))
        .route("/workspaces/{wid}/tasks/{id}/run", post(run_task))
        .route("/workspaces/{wid}/tasks/{id}/cancel", post(cancel_task))
        .route("/workspaces/{wid}/tasks/{id}/review", post(review_task))
        .route(
            "/workspaces/{wid}/tasks/{id}/artifacts/{aid}",
            get(artifact),
        )
        .route(
            "/workspaces/{wid}/knowledge/{id}",
            put(edit_knowledge).delete(delete_knowledge),
        )
        .route(
            "/workspaces/{wid}/knowledge/{id}/restore",
            post(restore_knowledge),
        )
        .route("/workspaces/{wid}/agents", get(agents).post(create_agent))
        .route(
            "/workspaces/{wid}/agents/{id}",
            put(edit_agent).delete(delete_agent),
        )
        .route("/workspaces/{wid}/agents/{id}/restore", post(restore_agent))
        .route("/workspaces/{wid}/trash", get(workspace_trash))
        .route("/trash", get(workspace_bin))
        .route("/connections", get(connections))
        .route("/connections/{provider}", put(connection))
        .route("/profile", put(profile))
        .route("/admin/users", get(list_users))
        .route("/admin/users/{id}", put(edit_user).delete(delete_user))
        .route("/admin/users/{id}/restore", post(restore_user))
        .route("/workspaces/{wid}/members", get(members).post(save_member))
        .route("/workspaces/{wid}/members/{id}", delete(remove_member))
}
pub(crate) async fn audit(a: &App, u: &User, wid: Option<Uuid>, action: &str) -> Result<()> {
    sqlx::query("INSERT INTO audit_events(user_id,workspace_id,action) VALUES($1,$2,$3)")
        .bind(u.id)
        .bind(wid)
        .bind(action)
        .execute(&a.db)
        .await?;
    Ok(())
}
// Invalidating execution is durable: restoring access never revives an old
// request, and a quick disable/enable cannot erase a running cancellation.
async fn invalidate_execution(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    wid: Option<Uuid>,
    uid: Option<Uuid>,
    provider: Option<&str>,
) -> Result<()> {
    sqlx::query("UPDATE tasks SET execution_requested=false,cancel_requested=cancel_requested OR status='running',version=version+1 WHERE ($1::uuid IS NULL OR workspace_id=$1) AND ($2::uuid IS NULL OR created_by=$2) AND ($3::text IS NULL OR provider=$3) AND (execution_requested OR status='running')")
        .bind(wid).bind(uid).bind(provider).execute(&mut **tx).await?;
    Ok(())
}
pub(crate) async fn owner(a: &App, u: &User, wid: Uuid) -> Result<()> {
    let yes:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM memberships WHERE workspace_id=$1 AND user_id=$2 AND role='owner')").bind(wid).bind(u.id).fetch_one(&a.db).await?;
    if !u.is_super_admin && !yes {
        return Err(Error(StatusCode::FORBIDDEN, "Workspace owner required"));
    }
    Ok(())
}
pub(crate) fn changed(n: u64) -> Result<Json<Value>> {
    if n == 0 {
        Err(Error(
            StatusCode::CONFLICT,
            "Item missing, modified elsewhere, or unavailable in its current state",
        ))
    } else {
        Ok(Json(json!({"ok":true})))
    }
}
