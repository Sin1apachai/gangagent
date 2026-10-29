use super::*;
use domain::{PlanPolicy, PlanStep};
pub(crate) struct PlanService {
    repository: infrastructure::PlanRepository,
}
impl PlanService {
    pub fn new(db: PgPool) -> Self {
        Self {
            repository: infrastructure::PlanRepository::new(db),
        }
    }
    pub async fn draft(
        &self,
        uid: Uuid,
        wid: Uuid,
        goal: &str,
        steps: Vec<PlanStep>,
        planner: Option<Uuid>,
    ) -> Result<Uuid> {
        if !valid(goal, 20000) || (!steps.is_empty() && !PlanPolicy::validate(&steps)) {
            return Err(bad(
                "Invalid goal or plan (1–8 ordered steps; dependencies must point backwards)",
            ));
        }
        self.repository
            .create(uid, wid, goal, json!(steps), planner)
            .await
    }
}
