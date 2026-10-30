use super::*;
#[derive(Clone, Serialize, Deserialize)]
pub(crate) struct Choice {
    pub(crate) id: String,
    pub(crate) name: String,
}
pub(crate) fn valid_id(provider: &str, id: &str) -> bool {
    if id.is_empty() {
        return true;
    }
    if id.len() > 80
        || !id.bytes().all(|c| {
            c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, b'-' | b'.' | b'_')
        })
    {
        return false;
    }
    match provider {
        "codex" => id.starts_with("gpt-"),
        "claude" => matches!(id, "sonnet" | "opus" | "haiku"),
        _ => false,
    }
}
pub(crate) fn worker_choices(provider: &str, fixture: bool) -> Vec<Choice> {
    if provider == "claude" {
        return ["sonnet", "opus", "haiku"]
            .iter()
            .map(|s| Choice {
                id: s.to_string(),
                name: format!("Claude {}", s),
            })
            .collect();
    }
    if fixture {
        return ["gpt-6.1-sol", "gpt-6-astra"]
            .iter()
            .map(|s| Choice {
                id: s.to_string(),
                name: s.to_string(),
            })
            .collect();
    }
    let path = "/home/office/.codex/models_cache.json";
    if std::fs::metadata(path)
        .map(|m| m.len() > 2_000_000)
        .unwrap_or(true)
    {
        return vec![];
    }
    let cache: Value = match std::fs::read(path)
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
    {
        Some(v) => v,
        None => return vec![],
    };
    cache
        .get("models")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|m| m["visibility"] == "list")
        .filter_map(|m| {
            let id = m["slug"].as_str()?;
            if !valid_id("codex", id) || id.is_empty() {
                return None;
            }
            Some(Choice {
                id: id.into(),
                name: m["display_name"]
                    .as_str()
                    .unwrap_or(id)
                    .chars()
                    .take(100)
                    .collect(),
            })
        })
        .take(30)
        .collect()
}
pub(crate) fn routes() -> Router<App> {
    Router::new().route("/models", get(list))
}
async fn catalog(a: &App, uid: Uuid) -> Result<Value> {
    let rows:Vec<Value>=sqlx::query_scalar("SELECT providers FROM workers WHERE user_id=$1 AND heartbeat_at>now()-interval '30 seconds' ORDER BY id").bind(uid).fetch_all(&a.db).await?;
    let mut result = json!({"codex":[],"claude":[]});
    for provider in ["codex", "claude"] {
        let mut seen = std::collections::HashSet::new();
        let mut choices = vec![];
        for row in &rows {
            for value in row[provider]["models"].as_array().into_iter().flatten() {
                if let Ok(c) = serde_json::from_value::<Choice>(value.clone()) {
                    if !c.id.is_empty() && valid_id(provider, &c.id) && seen.insert(c.id.clone()) {
                        choices.push(c);
                    }
                }
            }
        }
        result[provider] = json!(choices);
    }
    Ok(result)
}
async fn list(State(a): State<App>, h: HeaderMap) -> Result<Json<Value>> {
    let u = user(&a, &h).await?;
    Ok(Json(catalog(&a, u.id).await?))
}
pub(crate) async fn validate_choice(a: &App, uid: Uuid, provider: &str, model: &str) -> Result<()> {
    if model.is_empty() {
        return Ok(());
    }
    if !valid_id(provider, model)
        || !catalog(a, uid).await?[provider]
            .as_array()
            .is_some_and(|cs| cs.iter().any(|c| c["id"] == model))
    {
        return Err(bad(
            "Model is not in your online worker catalog; refresh models or choose provider default",
        ));
    }
    Ok(())
}
pub(crate) fn frozen(context: Option<&Value>) -> Option<&str> {
    context?
        .get("agent")?
        .get("model")?
        .as_str()
        .filter(|s| !s.is_empty())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn provider_model_ids_are_restricted() {
        assert!(valid_id("codex", "gpt-6.1-sol"));
        assert!(!valid_id("codex", "--config"));
        assert!(!valid_id("codex", "sonnet"));
        assert!(valid_id("claude", "sonnet"));
        assert!(!valid_id("claude", "fable"));
        assert!(!valid_id("claude", "best"));
        assert!(!valid_id("claude", "gpt-6-astra"));
    }
    #[test]
    fn frozen_model_missing_keeps_legacy_default() {
        assert_eq!(
            frozen(Some(&json!({"agent":{"model":"sonnet"}}))),
            Some("sonnet")
        );
        assert_eq!(frozen(Some(&json!({"agent":{"name":"Legacy"}}))), None);
    }
}
