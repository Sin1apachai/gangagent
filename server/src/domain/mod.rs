use serde::{Deserialize, Serialize};
use uuid::Uuid;
#[derive(Clone, Serialize, Deserialize)]
pub(crate) struct PlanStep {
    pub title: String,
    pub description: String,
    pub agent_id: Uuid,
    #[serde(default)]
    pub depends_on: Vec<usize>,
}
pub(crate) struct PlanPolicy;
impl PlanPolicy {
    pub fn validate(steps: &[PlanStep]) -> bool {
        !steps.is_empty()
            && steps.len() <= 8
            && steps.iter().enumerate().all(|(index, s)| {
                !s.title.trim().is_empty()
                    && s.title.len() <= 200
                    && s.description.len() <= 20000
                    && s.depends_on.iter().all(|&p| p < index)
            })
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn plan_cannot_cycle_or_exceed_budget() {
        let mut s = PlanStep {
            title: "Build".into(),
            description: String::new(),
            agent_id: Uuid::new_v4(),
            depends_on: vec![0],
        };
        assert!(!PlanPolicy::validate(&[s.clone()]));
        s.depends_on.clear();
        assert!(PlanPolicy::validate(&[s.clone()]));
        assert!(!PlanPolicy::validate(&vec![s; 9]));
    }
}
