use super::*;
mod api;
mod policy;
mod runner;
pub(crate) mod standards;
pub(crate) use api::tick;
pub(crate) use runner::run_worker;
pub(crate) fn routes() -> Router<App> {
    api::routes()
}
pub(crate) fn start(a: App) {
    tokio::spawn(async move {
        loop {
            if tick(&a).await.is_err() {
                eprintln!("Runtime scheduler cycle failed");
            }
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        }
    });
}

pub(crate) async fn attach_feedback(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    wid: Uuid,
    task: Uuid,
) -> Result<()> {
    sqlx::query("UPDATE tasks t SET execution_context=jsonb_set(COALESCE(t.execution_context,'{}'::jsonb),'{runtime_feedback}', jsonb_build_object('source_run_id',r.source_run_id,'status',r.status,'error',r.error,'evidence',r.evidence,'log',right(r.log,4000))) FROM runtime_jobs r WHERE t.id=$1 AND t.workspace_id=$2 AND t.runtime_enabled AND r.task_id=t.id AND r.source_run_id=t.current_run_id AND r.id=(SELECT j.id FROM runtime_jobs j WHERE j.task_id=t.id AND j.source_run_id=t.current_run_id ORDER BY j.created_at DESC LIMIT 1)").bind(task).bind(wid).execute(&mut **tx).await?;
    Ok(())
}
