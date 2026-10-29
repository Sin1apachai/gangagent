use serde::{Deserialize, Serialize};
use uuid::Uuid;
#[derive(Clone, Serialize, Deserialize)]
pub(crate) struct PlanStep {
    pub title: String,
    pub description: String,
    pub agent_id: Uuid,
    #[serde(default)]
    pub depends_on: Vec<usize>,
    #[serde(default)]
    pub input_contract: String,
    #[serde(default)]
    pub output_contract: String,
    #[serde(default)]
    pub acceptance_criteria: String,
    #[serde(default)]
    pub required_files: Vec<String>,
    #[serde(default)]
    pub skill_ids: Vec<Uuid>,
    #[serde(default)]
    pub reviewer_id: Option<Uuid>,
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
                    && s.depends_on
                        .iter()
                        .collect::<std::collections::HashSet<_>>()
                        .len()
                        == s.depends_on.len()
                    && s.skill_ids.len() <= 8
                    && s.skill_ids
                        .iter()
                        .collect::<std::collections::HashSet<_>>()
                        .len()
                        == s.skill_ids.len()
                    && s.input_contract.len() <= 4000
                    && s.output_contract.len() <= 4000
                    && s.acceptance_criteria.len() <= 10000
                    && s.required_files.len() <= 10
                    && s.required_files
                        .iter()
                        .collect::<std::collections::HashSet<_>>()
                        .len()
                        == s.required_files.len()
                    && s.required_files.iter().all(|f| {
                        crate::phase2::safe_relative(f)
                            && f.len() <= 240
                            && f.split('/').count() <= 8
                            && !f.split('/').any(|p| {
                                p.is_empty()
                                    || p.starts_with('.')
                                    || p.contains('\\')
                                    || p.chars().any(char::is_control)
                            })
                            && !matches!(f.split('/').next(), Some("inputs" | "references"))
                    })
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
            input_contract: String::new(),
            output_contract: String::new(),
            acceptance_criteria: String::new(),
            required_files: vec![],
            skill_ids: vec![],
            reviewer_id: None,
        };
        assert!(!PlanPolicy::validate(&[s.clone()]));
        s.depends_on.clear();
        assert!(PlanPolicy::validate(&[s.clone()]));
        assert!(!PlanPolicy::validate(&vec![s; 9]));
    }
}

#[cfg(test)]
mod workflow_tests {
    use super::*;
    fn step() -> PlanStep {
        serde_json::from_value(serde_json::json!({"title":"Deliver", "description":"Evidence", "agent_id":Uuid::new_v4(), "depends_on":[]})).unwrap()
    }
    #[test]
    fn branch_join_has_unique_backward_edges() {
        let a = step();
        let mut b = step();
        b.depends_on = vec![0];
        let mut c = b.clone();
        let mut d = step();
        d.depends_on = vec![1, 2];
        assert!(PlanPolicy::validate(&[a.clone(), b.clone(), c.clone(), d]));
        c.depends_on = vec![0, 0];
        assert!(!PlanPolicy::validate(&[a, b, c]));
    }
    #[test]
    fn file_contract_cannot_escape_or_reuse_input() {
        for name in [
            "../out",
            "/absolute",
            "inputs/file",
            "references/file",
            "a//b",
            "a/./b",
            "a/../b",
            "a\\b",
            ".hidden",
            "a/\n",
        ] {
            let mut s = step();
            s.required_files = vec![name.into()];
            assert!(!PlanPolicy::validate(&[s]), "{name}");
        }
        let mut s = step();
        s.required_files = vec!["docs/result.md".into()];
        assert!(PlanPolicy::validate(&[s]));
    }
    #[test]
    fn skill_and_file_contract_budgets_are_enforced() {
        let mut s = step();
        let skill = Uuid::new_v4();
        s.skill_ids = vec![skill, skill];
        assert!(!PlanPolicy::validate(&[s.clone()]));
        s.skill_ids.clear();
        s.required_files = vec!["out.md".into(), "out.md".into()];
        assert!(!PlanPolicy::validate(&[s.clone()]));
        s.required_files.clear();
        s.output_contract = "a".repeat(4001);
        assert!(!PlanPolicy::validate(&[s]));
    }
}
