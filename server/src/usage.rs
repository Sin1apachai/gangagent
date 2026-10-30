use serde_json::{json, Value};
// Only numerical counters are retained, never raw provider output.
fn counter(v: &Value, key: &str) -> Value {
    v.get(key)
        .and_then(Value::as_u64)
        .map(Value::from)
        .unwrap_or(Value::Null)
}
pub(crate) fn provider_usage(provider: &str, output: &[u8]) -> Value {
    if provider == "claude" {
        if let Ok(v) = serde_json::from_slice::<Value>(output) {
            let u = &v["usage"];
            return json!({"source":"provider", "input_tokens":counter(u,"input_tokens"), "output_tokens":counter(u,"output_tokens"), "cache_read_tokens":counter(u,"cache_read_input_tokens"), "cache_write_tokens":counter(u,"cache_creation_input_tokens"), "input_semantics":"uncached; cache read/write reported separately"});
        }
    } else {
        for line in output.split(|b| *b == b'\n').rev() {
            if let Ok(v) = serde_json::from_slice::<Value>(line) {
                if v["type"] == "turn.completed" {
                    let u = &v["usage"];
                    return json!({"source":"provider", "input_tokens":counter(u,"input_tokens"), "output_tokens":counter(u,"output_tokens"), "cache_read_tokens":counter(u,"cached_input_tokens"), "cache_write_tokens":null, "input_semantics":"input includes cached input"});
                }
            }
        }
    }
    json!({"source":"unavailable"})
}
pub(crate) fn compact_context(context: &Value) -> String {
    serde_json::to_string(context).expect("JSON value is serializable")
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn counters_are_numeric_and_missing_is_not_zero() {
        let v=provider_usage("codex",br#"{"type":"turn.completed","usage":{"input_tokens":100,"cached_input_tokens":40,"output_tokens":12,"secret":"never store"}}"#);
        assert_eq!(v["input_tokens"], 100);
        assert_eq!(v["cache_read_tokens"], 40);
        assert!(v.get("secret").is_none());
        assert!(v["cache_write_tokens"].is_null());
        let v = provider_usage(
            "claude",
            br#"{"usage":{"input_tokens":5,"output_tokens":-1,"cache_read_input_tokens":40}}"#,
        );
        assert_eq!(v["input_tokens"], 5);
        assert!(v["output_tokens"].is_null());
        assert_eq!(
            provider_usage("codex", b"bad output")["source"],
            "unavailable"
        );
    }
    #[test]
    fn lossless_context_compaction() {
        let v = json!({"agent":{"instructions":"Keep  spaces and\nline breaks", "role":"Engineer"},"skills":[{"instructions":"exact contract"}]});
        let compact = compact_context(&v);
        assert_eq!(serde_json::from_str::<Value>(&compact).unwrap(), v);
        assert!(compact.len() < serde_json::to_string_pretty(&v).unwrap().len());
    }
}
