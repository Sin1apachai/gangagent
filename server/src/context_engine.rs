use super::*;
use std::collections::BTreeSet;
#[derive(Clone, FromRow)]
pub(crate) struct Note {
    pub id: Uuid,
    pub title: String,
    pub content: String,
    pub version: i32,
}
pub(crate) struct Selection {
    pub text: String,
    pub baseline: String,
    pub metrics: Value,
}
fn words(s: &str) -> BTreeSet<String> {
    let stop = [
        "the", "and", "for", "this", "that", "with", "from", "into", "must", "only", "task",
        "work", "create", "write", "return", "file", "json", "use", "not", "all", "are", "should",
        "read", "exactly", "please", "answer", "report", "result", "have", "your", "will", "when",
        "then",
    ];
    s.to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|s| s.chars().count() >= 3 && !stop.contains(s))
        .take(400)
        .map(String::from)
        .collect()
}
fn render(notes: &[&Note]) -> String {
    let mut text = String::new();
    for n in notes {
        let entry = format!(
            "\n### {} [knowledge:{} v{}]\n{}\n",
            n.title, n.id, n.version, n.content
        );
        if text.len() + entry.len() > 60000 {
            break;
        }
        text.push_str(&entry);
    }
    text
}
pub(crate) fn pins(query: &str) -> BTreeSet<Uuid> {
    query
        .split("[[knowledge:")
        .skip(1)
        .filter_map(|s| s.split("]]").next().and_then(|v| Uuid::parse_str(v).ok()))
        .collect()
}
pub(crate) fn select(notes: &[Note], query: &str, focused: bool) -> Selection {
    let baseline = render(&notes.iter().take(20).collect::<Vec<_>>());
    let terms = words(query);
    let pins = pins(query);
    let mut ranked: Vec<(usize, &Note)> = notes
        .iter()
        .map(|n| {
            let title = words(&n.title);
            let content = words_unbounded(&n.content);
            let score =
                terms.intersection(&title).count() * 4 + terms.intersection(&content).count();
            (score, n)
        })
        .filter(|(s, n)| *s > 0 || pins.contains(&n.id))
        .collect();
    ranked.sort_by(|a, b| {
        pins.contains(&b.1.id)
            .cmp(&pins.contains(&a.1.id))
            .then_with(|| b.0.cmp(&a.0))
            .then_with(|| a.1.id.cmp(&b.1.id))
    });
    let fallback = !focused
        || (ranked.is_empty() && pins.is_empty())
        || pins.iter().any(|id| !notes.iter().any(|n| n.id == *id));
    let mut selected: Vec<&Note> = if fallback {
        notes.iter().take(20).collect()
    } else {
        ranked
            .iter()
            .take(6.max(pins.len()))
            .map(|(_, n)| *n)
            .collect()
    };
    // Preserve complete selected documents; oversized selections fall back to the full baseline.
    let over_budget = selected
        .iter()
        .map(|n| n.content.len() + n.title.len() + 90)
        .sum::<usize>()
        > 60000;
    if over_budget && pins.is_empty() {
        selected = notes.iter().take(20).collect();
    }
    let reason = if !focused {
        "full"
    } else if fallback {
        "no_confident_match_or_missing_pin_full_fallback"
    } else if over_budget {
        "document_budget_full_fallback"
    } else {
        "lexical_rank_v1"
    };
    let mut included = Vec::new();
    let mut bytes = 0;
    for n in selected {
        let len = format!(
            "\n### {} [knowledge:{} v{}]\n{}\n",
            n.title, n.id, n.version, n.content
        )
        .len();
        if bytes + len > 60000 {
            break;
        }
        bytes += len;
        included.push(n);
    }
    let selected = included;
    let source:Vec<Value>=selected.iter().map(|n|json!({"id":n.id,"version":n.version,"title":n.title,"sha256":format!("{:x}",Sha256::digest(n.content.as_bytes()))})).collect();
    let blocked =
        focused && (pins.len() > 20 || pins.iter().any(|id| !selected.iter().any(|n| n.id == *id)));
    let text = render(&selected);
    Selection {
        text,
        baseline,
        metrics: json!({"knowledge_candidates":notes.len(),"knowledge_selected":selected.len(),"knowledge_selection":reason,"knowledge_sources":serde_json::to_string(&source).unwrap(),"retrieval_version":1,"context_blocked":if blocked {1}else{0}}),
    }
}
fn words_unbounded(s: &str) -> BTreeSet<String> {
    s.to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|s| s.chars().count() >= 3)
        .map(String::from)
        .collect()
}
pub(crate) fn handoff(value: &Value, registered: &BTreeSet<String>) -> Option<String> {
    let summary = value.get("summary")?.as_str()?;
    if summary.trim().is_empty() || summary.len() > 3000 {
        return None;
    }
    for key in ["decisions", "open_questions"] {
        let a = value.get(key)?.as_array()?;
        if a.len() > 10 || a.iter().any(|v| v.as_str().is_none_or(|s| s.len() > 1500)) {
            return None;
        }
    }
    let artifacts = value.get("artifacts")?.as_array()?;
    if artifacts.is_empty()
        || artifacts.len() > 20
        || artifacts.iter().any(|v| {
            v.as_str()
                .is_none_or(|s| !phase2::safe_relative(s) || !registered.contains(s))
        })
    {
        return None;
    }
    Some(serde_json::to_string(value).ok()?)
}
#[cfg(test)]
mod tests {
    use super::*;
    fn note(title: &str, content: &str) -> Note {
        Note {
            id: Uuid::new_v4(),
            title: title.into(),
            content: content.into(),
            version: 0,
        }
    }
    #[test]
    fn relevance_pins_fallback_and_old_documents() {
        let mut notes = (0..20)
            .map(|_| note("Cafeteria", "Lunch schedule and parking"))
            .collect::<Vec<_>>();
        let target = note(
            "Orion deployment",
            "Orion requires version seven and rollback",
        );
        let id = target.id;
        notes.push(target);
        let s = select(&notes, "Orion deployment", true);
        assert_eq!(s.metrics["knowledge_selected"], 1);
        assert!(s.text.contains("version seven"));
        assert!(!s.text.contains("Lunch"));
        assert!(select(&notes, "unknown keyword", true)
            .text
            .contains("Lunch"));
        assert!(select(&notes, &format!("[[knowledge:{id}]]"), true)
            .text
            .contains("version seven"));
        assert!(select(&notes, "Orion", false).text.contains("Lunch"));
    }
    #[test]
    fn handoff_cannot_reference_unregistered_files() {
        let good = json!({"summary":"Ready","decisions":["Keep two spaces"],"open_questions":[],"artifacts":["answer.json"]});
        let files = BTreeSet::from(["answer.json".into()]);
        assert!(handoff(&good, &files).is_some());
        assert!(handoff(&good, &BTreeSet::new()).is_none());
        let mut bad = good.clone();
        bad["artifacts"] = json!(["../secret"]);
        assert!(handoff(&bad, &files).is_none());
    }
}

#[derive(Deserialize)]
struct ContextPolicy {
    version: i32,
    context_format: String,
}
pub(crate) fn routes() -> Router<App> {
    Router::new()
        .route(
            "/workspaces/{wid}/plans/{id}/usage",
            axum::routing::get(plan_usage),
        )
        .route(
            "/workspaces/{wid}/tasks/{id}/context",
            axum::routing::put(set_policy),
        )
}
async fn set_policy(
    State(a): State<App>,
    h: HeaderMap,
    Path((wid, id)): Path<(Uuid, Uuid)>,
    Json(b): Json<ContextPolicy>,
) -> Result<Json<Value>> {
    let u = user(&a, &h).await?;
    access(&a, &u, wid, true).await?;
    if !matches!(b.context_format.as_str(), "compact" | "focused") {
        return Err(bad("Invalid context mode"));
    }
    let n=sqlx::query("UPDATE tasks SET context_format=$1,version=version+1 WHERE id=$2 AND workspace_id=$3 AND version=$4 AND deleted_at IS NULL AND status NOT IN ('running','done','cancelled') AND NOT execution_requested AND (created_by=$5 OR $6)").bind(b.context_format).bind(id).bind(wid).bind(b.version).bind(u.id).bind(u.is_super_admin).execute(&a.db).await?.rows_affected();
    if n > 0 {
        phase2::audit(&a, &u, Some(wid), "task.context_policy.updated").await?;
    }
    phase2::changed(n)
}
#[cfg(test)]
mod guard_tests {
    use super::*;
    #[test]
    fn required_notes_never_silently_disappear_at_budget_limit() {
        let a = Note {
            id: Uuid::new_v4(),
            title: "Orion first".into(),
            content: "a".repeat(49000),
            version: 0,
        };
        let b = Note {
            id: Uuid::new_v4(),
            title: "Orion second".into(),
            content: "b".repeat(49000),
            version: 0,
        };
        let query = format!("[[knowledge:{}]] [[knowledge:{}]]", a.id, b.id);
        let s = select(&[a, b], &query, true);
        assert_eq!(s.metrics["context_blocked"], 1);
        assert_eq!(s.metrics["knowledge_selected"], 1);
        let sources: Value =
            serde_json::from_str(s.metrics["knowledge_sources"].as_str().unwrap()).unwrap();
        assert_eq!(sources.as_array().unwrap().len(), 1);
    }
}

async fn plan_usage(
    State(a): State<App>,
    h: HeaderMap,
    Path((wid, id)): Path<(Uuid, Uuid)>,
) -> Result<Json<Value>> {
    let u = user(&a, &h).await?;
    access(&a, &u, wid, false).await?;
    let exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM plans WHERE id=$1 AND workspace_id=$2)")
            .bind(id)
            .bind(wid)
            .fetch_one(&a.db)
            .await?;
    if !exists {
        return Err(Error(StatusCode::NOT_FOUND, "Plan not found"));
    }
    let rows:Vec<(String,Value)>=sqlx::query_as("SELECT t.provider,r.usage_metrics FROM tasks t JOIN task_runs r ON r.task_id=t.id WHERE t.workspace_id=$1 AND (t.plan_id=$2 OR t.id=(SELECT planner_task_id FROM plans WHERE id=$2 AND workspace_id=$1)) ORDER BY r.started_at").bind(wid).bind(id).fetch_all(&a.db).await?;
    let mut totals = std::collections::BTreeMap::<String, Value>::new();
    for (provider, m) in rows {
        let t = totals
            .entry(provider.clone())
            .or_insert_with(|| json!({"provider":provider,"runs":0,"reported_runs":0}));
        t["runs"] = json!(t["runs"].as_u64().unwrap_or(0) + 1);
        if m["source"] != "provider" {
            continue;
        }
        t["reported_runs"] = json!(t["reported_runs"].as_u64().unwrap_or(0) + 1);
        for key in [
            "input_tokens",
            "output_tokens",
            "cache_read_tokens",
            "cache_write_tokens",
            "provider_elapsed_ms",
        ] {
            if let Some(n) = m[key].as_u64() {
                let count_key = format!("{key}_runs");
                t[&count_key] = json!(t[&count_key].as_u64().unwrap_or(0) + 1);
                t[key] = json!(t[key].as_u64().unwrap_or(0).saturating_add(n));
            }
        }
    }
    Ok(Json(
        json!({"providers":totals.into_values().collect::<Vec<_>>(),"includes":"all recorded attempts, revisions, failures and planner runs; missing telemetry stays unavailable"}),
    ))
}
