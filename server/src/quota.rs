use super::*;
use sqlx::{Postgres, Transaction};
use std::time::Duration;
pub(crate) fn routes() -> Router<App> {
    Router::new().route(
        "/workspaces/{wid}/tasks/{id}/quota",
        axum::routing::put(configure),
    )
}
#[derive(Deserialize)]
struct QuotaForm {
    version: i32,
    auto_resume: bool,
    check_minutes: i32,
    reset_at: Option<String>,
}
async fn configure(
    State(a): State<App>,
    h: HeaderMap,
    Path((wid, id)): Path<(Uuid, Uuid)>,
    Json(b): Json<QuotaForm>,
) -> Result<Json<Value>> {
    let u = user(&a, &h).await?;
    access(&a, &u, wid, true).await?;
    if !(5..=1440).contains(&b.check_minutes) {
        return Err(bad("Quota check interval must be 5–1440 minutes"));
    }
    let creator: Option<Uuid> = sqlx::query_scalar(
        "SELECT created_by FROM tasks WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL",
    )
    .bind(id)
    .bind(wid)
    .fetch_optional(&a.db)
    .await?;
    if creator != Some(u.id) && !u.is_super_admin {
        return Err(Error(
            StatusCode::FORBIDDEN,
            "Only the task owner can configure automatic quota retries",
        ));
    }
    let reset = b.reset_at.filter(|v| !v.is_empty());
    if let Some(value) = reset.as_deref() {
        if value.len() > 40
            || !value.contains('T')
            || !(value.ends_with('Z')
                || value
                    .get(19..)
                    .is_some_and(|v| v.contains('+') || v.contains('-')))
        {
            return Err(bad("Reset time must include an explicit timezone"));
        }
        let valid:bool=sqlx::query_scalar("SELECT pg_input_is_valid($1::text,'timestamp with time zone') AND CASE WHEN pg_input_is_valid($1::text,'timestamp with time zone') THEN $1::timestamptz>now() ELSE false END").bind(value).fetch_one(&a.db).await?;
        if !valid {
            return Err(bad("Reset time must be a valid future timestamp"));
        }
    }
    let n=sqlx::query("UPDATE tasks SET quota_auto_resume=$1,quota_check_minutes=$2,quota_reset_at=$3::text::timestamptz,next_quota_check_at=CASE WHEN $1 AND status='waiting_quota' THEN coalesce($3::text::timestamptz+interval '2 seconds',now()+make_interval(mins=>$2)) ELSE NULL END,version=version+1 WHERE id=$4 AND workspace_id=$5 AND version=$6 AND deleted_at IS NULL AND status NOT IN ('done','running')").bind(b.auto_resume).bind(b.check_minutes).bind(reset).bind(id).bind(wid).bind(b.version).execute(&a.db).await?.rows_affected();
    if n > 0 {
        phase2::audit(&a, &u, Some(wid), "task.quota_policy_changed").await?;
    }
    phase2::changed(n)
}
// Only expose validated reset metadata; never store raw provider output.
fn valid_reset_iso(value: &str) -> bool {
    if !matches!(value.len(), 20 | 25)
        || value.get(..10).and_then(master_data::date).is_none()
        || value.as_bytes().get(10) != Some(&b'T')
        || value.as_bytes().get(13) != Some(&b':')
        || value.as_bytes().get(16) != Some(&b':')
    {
        return false;
    }
    let clock = |start, end, max| {
        value
            .get(start..end)
            .and_then(|v: &str| v.parse::<u32>().ok())
            .is_some_and(|v| v <= max)
    };
    clock(11, 13, 23)
        && clock(14, 16, 59)
        && clock(17, 19, 59)
        && ((value.len() == 20 && value.ends_with('Z'))
            || (value.len() == 25
                && matches!(value.as_bytes()[19], b'+' | b'-')
                && value.as_bytes()[22] == b':'
                && clock(20, 22, 23)
                && clock(23, 25, 59)))
}
pub(crate) fn reset_hint(raw: &str) -> Option<String> {
    fn search(v: &Value) -> Option<String> {
        match v {
            Value::Object(map) => {
                for (k, v) in map {
                    if matches!(
                        k.as_str(),
                        "reset_at" | "resets_at" | "resetAt" | "resetsAt"
                    ) {
                        if let Some(n) = v
                            .as_u64()
                            .filter(|n| *n > 1_000_000_000 && *n < 100_000_000_000)
                        {
                            return Some(n.to_string());
                        }
                        if let Some(s) = v.as_str().filter(|s| valid_reset_iso(s)) {
                            return Some(s.into());
                        }
                    }
                    if let Some(found) = search(v) {
                        return Some(found);
                    }
                }
                None
            }
            Value::Array(a) => a.iter().find_map(search),
            _ => None,
        }
    }
    for line in raw.lines() {
        if let Ok(value) = serde_json::from_str::<Value>(line) {
            if let Some(value) = search(&value) {
                return Some(value);
            }
        }
    }
    for part in raw.split_whitespace() {
        let part = part.trim_matches(|c: char| !c.is_ascii_digit() && c != 'Z');
        if valid_reset_iso(part) {
            return Some(part.into());
        }
    }
    None
}
pub(crate) async fn waiting(
    tx: &mut Transaction<'_, Postgres>,
    id: Uuid,
    error: &str,
) -> std::result::Result<(), sqlx::Error> {
    let hint = error
        .strip_prefix("Provider quota reached; reset_at=")
        .and_then(|v| v.split_whitespace().next());
    let epoch = hint
        .and_then(|h| h.parse::<f64>().ok())
        .filter(|n| n.is_finite() && *n > 1_000_000_000.0 && *n < 100_000_000_000.0);
    let iso = hint
        .filter(|h| h.len() <= 40 && h.contains('T'))
        .map(str::to_owned);
    sqlx::query("WITH r AS(SELECT coalesce(to_timestamp($2),CASE WHEN pg_input_is_valid($3::text,'timestamp with time zone') THEN $3::timestamptz END) reset) UPDATE tasks SET quota_reset_at=r.reset,next_quota_check_at=CASE WHEN quota_auto_resume AND attempts<3 THEN CASE WHEN r.reset>now() THEN r.reset+interval '2 seconds' ELSE now()+make_interval(mins=>least(1440,quota_check_minutes*(1<<least(quota_retries,4)))) END ELSE NULL END FROM r WHERE id=$1").bind(id).bind(epoch).bind(iso).execute(&mut **tx).await?;
    Ok(())
}
pub(crate) fn scheduler(db: PgPool) {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(10));
        loop {
            interval.tick().await;
            if let Err(e) = resume_due(&db).await {
                eprintln!("Quota scheduler: {e}");
            }
        }
    });
}
async fn resume_due(db: &PgPool) -> std::result::Result<(), sqlx::Error> {
    let mut tx = db.begin().await?;
    let ids:Vec<Uuid>=sqlx::query_scalar("WITH eligible AS (SELECT t.id,row_number() OVER(PARTITION BY t.created_by,t.provider ORDER BY t.next_quota_check_at,t.created_at) rank FROM tasks t JOIN users u ON u.id=t.created_by JOIN workspaces w ON w.id=t.workspace_id JOIN provider_connections c ON c.user_id=t.created_by AND c.provider=t.provider WHERE t.status='waiting_quota' AND t.quota_auto_resume AND t.next_quota_check_at<=now() AND t.attempts<3 AND t.quota_retries<3 AND NOT t.cancel_requested AND t.deleted_at IS NULL AND u.deleted_at IS NULL AND w.deleted_at IS NULL AND c.enabled AND c.billing_acknowledged AND NOT c.reauth_required AND NOT office_worker_paused() AND (u.is_super_admin OR EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=u.id AND m.workspace_id=w.id AND m.role IN ('owner','member'))) AND (t.agent_id IS NULL OR EXISTS(SELECT 1 FROM agents a WHERE a.id=t.agent_id AND a.workspace_id=t.workspace_id AND a.provider=t.provider AND a.enabled AND a.deleted_at IS NULL)) AND (t.plan_id IS NULL OR EXISTS(SELECT 1 FROM plans p WHERE p.id=t.plan_id AND p.status='approved')) AND EXISTS(SELECT 1 FROM workers worker WHERE worker.user_id=u.id AND worker.heartbeat_at>now()-interval '45 seconds' AND worker.providers->t.provider->>'authenticated'='true')) UPDATE tasks SET status='queued',execution_requested=true,cancel_requested=false,next_quota_check_at=NULL,quota_retries=quota_retries+1,error='',version=version+1 WHERE id IN(SELECT id FROM eligible WHERE rank=1 LIMIT 32) AND status='waiting_quota' AND quota_auto_resume RETURNING id").fetch_all(&mut *tx).await?;
    for id in ids {
        sqlx::query("INSERT INTO task_events(task_id,message) VALUES($1,'Quota reset check due; authorized automatic retry queued')").bind(id).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reset_metadata_is_bounded_and_timezone_explicit() {
        assert_eq!(
            reset_hint(r#"{"error":{"reset_at":1800000000}}"#),
            Some("1800000000".into())
        );
        assert_eq!(
            reset_hint("Quota resets 2027-01-01T12:00:00Z"),
            Some("2027-01-01T12:00:00Z".into())
        );
        assert!(reset_hint("resets 5pm").is_none());
        assert!(reset_hint(r#"{"reset_at":"tomorrow"}"#).is_none());
    }
}
