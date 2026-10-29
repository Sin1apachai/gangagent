pub(crate) mod semantic;
use super::*;
#[derive(Clone)]
pub(crate) struct PlanRepository {
    db: PgPool,
}
impl PlanRepository {
    pub fn new(db: PgPool) -> Self {
        Self { db }
    }
    pub async fn create(
        &self,
        uid: Uuid,
        wid: Uuid,
        goal: &str,
        steps: Value,
        planner: Option<Uuid>,
    ) -> Result<Uuid> {
        let id = Uuid::new_v4();
        sqlx::query("INSERT INTO plans(id,workspace_id,created_by,goal,steps,planner_task_id) VALUES($1,$2,$3,$4,$5,$6)").bind(id).bind(wid).bind(uid).bind(goal).bind(steps).bind(planner).execute(&self.db).await?;
        Ok(id)
    }
}
