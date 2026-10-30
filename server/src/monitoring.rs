use super::*;
use std::{collections::BTreeMap, time::Duration};
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Rule {
    enabled: bool,
    threshold_percent: f64,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Settings {
    hold_seconds: u64,
    recovery_margin: f64,
    rules: BTreeMap<String, Rule>,
}
const KEYS: [&str; 7] = [
    "vm_cpu",
    "vm_memory",
    "data_disk",
    "backup_disk",
    "app_memory",
    "redis_memory",
    "worker_memory",
];
fn validate(s: &Settings) -> bool {
    s.hold_seconds >= 5
        && s.hold_seconds <= 300
        && s.recovery_margin.is_finite()
        && s.recovery_margin >= 1.0
        && s.recovery_margin <= 20.0
        && s.rules.len() == KEYS.len()
        && KEYS.iter().all(|k| {
            s.rules.get(*k).is_some_and(|r| {
                r.threshold_percent.is_finite()
                    && r.threshold_percent >= 1.0
                    && r.threshold_percent <= 99.0
            })
        })
}
async fn admin(a: &App, h: &HeaderMap) -> Result<User> {
    let u = user(a, h).await?;
    if !u.is_super_admin {
        return Err(Error(StatusCode::FORBIDDEN, "Super admin required"));
    }
    Ok(u)
}
pub(crate) fn routes() -> Router<App> {
    Router::new()
        .route("/admin/resources", get(status))
        .route("/admin/resources/settings", axum::routing::put(save))
        .route("/admin/resources/notifications/read", post(mark_read))
}
async fn status(State(a): State<App>, h: HeaderMap) -> Result<Json<Value>> {
    let u = admin(&a, &h).await?;
    let config:Value=sqlx::query_scalar("SELECT jsonb_build_object('version',version,'settings',settings) FROM resource_settings WHERE id").fetch_one(&a.db).await?;
    let state:Option<Value>=sqlx::query_scalar("SELECT jsonb_build_object('sample',sample,'collected_at',collected_at,'stale',collected_at<now()-interval '20 seconds') FROM resource_state WHERE id").fetch_optional(&a.db).await?;
    let notifications:Vec<Value>=sqlx::query_scalar("SELECT to_jsonb(n)||jsonb_build_object('read',EXISTS(SELECT 1 FROM resource_notification_reads r WHERE r.notification_id=n.id AND r.user_id=$1)) FROM resource_notifications n ORDER BY created_at DESC,id LIMIT 100").bind(u.id).fetch_all(&a.db).await?;
    let unread:i64=sqlx::query_scalar("SELECT count(*) FROM resource_notifications n WHERE NOT EXISTS(SELECT 1 FROM resource_notification_reads r WHERE r.notification_id=n.id AND r.user_id=$1)").bind(u.id).fetch_one(&a.db).await?;
    let active: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM resource_notifications WHERE kind='warning' AND resolved_at IS NULL",
    )
    .fetch_one(&a.db)
    .await?;
    Ok(Json(
        json!({"config":config,"state":state,"notifications":notifications,"unread_count":unread,"active_count":active,"scope":"Docker Linux VM and cgroups, not physical macOS host","sample_interval_seconds":5}),
    ))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Save {
    version: i32,
    settings: Settings,
}
async fn save(State(a): State<App>, h: HeaderMap, Json(b): Json<Save>) -> Result<Json<Value>> {
    let u = admin(&a, &h).await?;
    if !validate(&b.settings) {
        return Err(bad(
            "Invalid resource thresholds; use 1–99 percent and a 5–300 second hold",
        ));
    }
    let n=sqlx::query("UPDATE resource_settings SET settings=$1,version=version+1,updated_by=$2,updated_at=now() WHERE id AND version=$3").bind(json!(b.settings)).bind(u.id).bind(b.version).execute(&a.db).await?.rows_affected();
    if n > 0 {
        phase2::audit(&a, &u, None, "monitoring.settings.updated").await?;
    }
    phase2::changed(n)
}
#[derive(Deserialize)]
struct Read {
    #[serde(default)]
    all: bool,
    #[serde(default)]
    ids: Vec<Uuid>,
}
async fn mark_read(State(a): State<App>, h: HeaderMap, Json(b): Json<Read>) -> Result<Json<Value>> {
    let u = admin(&a, &h).await?;
    if b.ids.len() > 100 || (!b.all && b.ids.is_empty()) {
        return Err(bad("Select notifications to mark read"));
    }
    sqlx::query("INSERT INTO resource_notification_reads(user_id,notification_id) SELECT $1,id FROM resource_notifications WHERE $2 OR id=ANY($3) ON CONFLICT DO NOTHING").bind(u.id).bind(b.all).bind(b.ids).execute(&a.db).await?;
    Ok(Json(json!({"ok":true})))
}
#[derive(Clone)]
struct Metric {
    key: String,
    rule: String,
    label: String,
    value: Option<f64>,
}
#[derive(Default, Clone, Serialize, Deserialize)]
struct Evaluation {
    since: Option<f64>,
    active: bool,
    last_seen: Option<f64>,
    policy: Option<String>,
}
#[derive(Debug, PartialEq)]
enum Event {
    Warning,
    Recovery,
}
fn evaluate(
    e: &mut Evaluation,
    value: Option<f64>,
    rule: &Rule,
    now: f64,
    hold: u64,
    margin: f64,
) -> Option<Event> {
    let policy = format!(
        "{}:{}:{}:{}",
        rule.enabled, rule.threshold_percent, hold, margin
    );
    if e.policy.as_deref() != Some(&policy) {
        e.since = None;
        e.policy = Some(policy);
    }
    if !rule.enabled {
        e.since = None;
        e.last_seen = Some(now);
        if e.active {
            e.active = false;
            return Some(Event::Recovery);
        }
        return None;
    }
    let Some(v) = value.filter(|n| n.is_finite()) else {
        e.since = None;
        return None;
    };
    if e.last_seen.is_none_or(|t| now - t > 20.0) {
        e.since = None;
    }
    e.last_seen = Some(now);
    if e.active {
        if v <= (rule.threshold_percent - margin).max(0.0) {
            e.active = false;
            e.since = None;
            return Some(Event::Recovery);
        }
        return None;
    }
    if v >= rule.threshold_percent {
        let since = *e.since.get_or_insert(now);
        if now - since >= hold as f64 {
            e.active = true;
            return Some(Event::Warning);
        }
    } else {
        e.since = None;
    }
    None
}
async fn collect(a: &App) -> Value {
    let (vm, app) = crate::resource_metrics::collect();
    let data_disk = crate::resource_metrics::disk("/data");
    let backup_disk = crate::resource_metrics::disk("/backups");
    let workers_result=sqlx::query_scalar::<_,Value>("SELECT jsonb_build_object('id',id,'online',heartbeat_at>now()-interval '20 seconds','resources',resources,'observed_at',heartbeat_at) FROM workers ORDER BY heartbeat_at DESC LIMIT 200").fetch_all(&a.db).await;
    let worker_inventory_available = workers_result.is_ok();
    let workers = workers_result.unwrap_or_default();
    let backup:Option<Value>=sqlx::query_scalar("SELECT jsonb_build_object('online',heartbeat_at>now()-interval '15 seconds','resources',resources,'observed_at',heartbeat_at) FROM backup_service WHERE id").fetch_optional(&a.db).await.unwrap_or_default();
    let database_bytes: Option<i64> =
        sqlx::query_scalar("SELECT pg_database_size(current_database())")
            .fetch_one(&a.db)
            .await
            .ok();
    let redis=tokio::time::timeout(Duration::from_secs(1),async {
    let mut value = Value::Null;
    if let Ok(mut c) = a.redis.get_multiplexed_async_connection().await {
        if let Ok(info) = redis::cmd("INFO")
            .arg("MEMORY")
            .query_async::<String>(&mut c)
            .await
        {
            let val = |key: &str| {
                info.lines().find_map(|l| {
                    l.strip_prefix(&format!("{key}:"))
                        .and_then(|v| v.trim().parse::<u64>().ok())
                })
            };
            let used = val("used_memory");
            let max = val("maxmemory").filter(|n| *n > 0);
            value = json!({"used_bytes":used,"limit_bytes":max,"remaining_bytes":used.zip(max).map(|(u,m)|m.saturating_sub(u)),"percent":used.zip(max).map(|(u,m)|(u as f64/m as f64*100.0).clamp(0.0,100.0))});
        }
    }
        value
    }).await.unwrap_or(Value::Null);
    let shared = !data_disk.is_null()
        && !backup_disk.is_null()
        && data_disk["filesystem_id"] == backup_disk["filesystem_id"];
    json!({"vm":vm,"app":app,"data_disk":data_disk,"backup_disk":backup_disk,"disks_share_filesystem":shared,"workers":workers,"worker_inventory_available":worker_inventory_available,"backup_service":backup,"postgres_database_bytes":database_bytes,"redis":redis})
}
fn metrics(sample: &Value) -> Vec<Metric> {
    let mut m = vec![];
    for (key, label, path, field) in [
        ("vm_cpu", "CPU ของ Docker VM", "vm", "cpu_percent"),
        ("vm_memory", "หน่วยความจำ Docker VM", "vm", "memory_percent"),
        ("data_disk", "พื้นที่เก็บผลงาน", "data_disk", "used_percent"),
        (
            "backup_disk",
            "พื้นที่เก็บไฟล์สำรอง",
            "backup_disk",
            "used_percent",
        ),
        ("app_memory", "หน่วยความจำเว็บ", "app", "memory_percent"),
        ("redis_memory", "งบหน่วยความจำ Redis", "redis", "percent"),
    ] {
        m.push(Metric {
            key: key.into(),
            rule: key.into(),
            label: label.into(),
            value: sample[path][field].as_f64(),
        });
    }
    if let Some(workers) = sample["workers"].as_array() {
        for w in workers {
            if let Some(id) = w["id"].as_str() {
                m.push(Metric {
                    key: format!("worker_memory:{id}"),
                    rule: "worker_memory".into(),
                    label: format!("หน่วยความจำ Worker {id}"),
                    value: if w["online"] == true {
                        w["resources"]["memory_percent"].as_f64()
                    } else {
                        None
                    },
                });
            }
        }
    }
    m
}
async fn tick(a: &App) -> std::result::Result<(), sqlx::Error> {
    let sample = tokio::time::timeout(Duration::from_secs(4), collect(a))
        .await
        .unwrap_or(Value::Null);
    if sample.is_null() {
        return Ok(());
    }
    let mut tx = a.db.begin().await?;
    let locked: bool = sqlx::query_scalar("SELECT pg_try_advisory_xact_lock(448721906)")
        .fetch_one(&mut *tx)
        .await?;
    if !locked {
        return Ok(());
    }
    let (settings,): (Value,) = sqlx::query_as("SELECT settings FROM resource_settings WHERE id")
        .fetch_one(&mut *tx)
        .await?;
    let Ok(settings) = serde_json::from_value::<Settings>(settings) else {
        return Ok(());
    };
    let state: Option<Value> = sqlx::query_scalar("SELECT evaluation FROM resource_state WHERE id")
        .fetch_optional(&mut *tx)
        .await?;
    let mut evaluations: BTreeMap<String, Evaluation> = state
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default();
    let now: f64 = sqlx::query_scalar("SELECT extract(epoch from now())::double precision")
        .fetch_one(&mut *tx)
        .await?;
    for metric in metrics(&sample) {
        let rule = &settings.rules[&metric.rule];
        let entry = evaluations.entry(metric.key.clone()).or_default();
        if let Some(event) = evaluate(
            entry,
            metric.value,
            rule,
            now,
            settings.hold_seconds,
            settings.recovery_margin,
        ) {
            let kind = if event == Event::Warning {
                "warning"
            } else {
                "recovery"
            };
            if event == Event::Recovery {
                sqlx::query("UPDATE resource_notifications SET resolved_at=now() WHERE resource_key=$1 AND kind='warning' AND resolved_at IS NULL").bind(&metric.key).execute(&mut *tx).await?;
            }
            sqlx::query("INSERT INTO resource_notifications(id,resource_key,kind,label,value_percent,threshold_percent,reason) VALUES($1,$2,$3,$4,$5,$6,$7)").bind(Uuid::new_v4()).bind(&metric.key).bind(kind).bind(metric.label).bind(metric.value).bind(rule.threshold_percent).bind(if !rule.enabled{"rule_disabled"}else{"threshold"}).execute(&mut *tx).await?;
        }
    }
    // A removed target is retired explicitly rather than reported as healthy.
    let keys = metrics(&sample)
        .into_iter()
        .map(|m| m.key)
        .collect::<Vec<_>>();
    let retired = evaluations
        .keys()
        .filter(|k| {
            !keys.contains(k)
                && (!k.starts_with("worker_memory:")
                    || sample["worker_inventory_available"] == true)
        })
        .cloned()
        .collect::<Vec<_>>();
    for key in retired {
        evaluations.remove(&key);
        sqlx::query("UPDATE resource_notifications SET resolved_at=now(),reason='target_removed' WHERE resource_key=$1 AND kind='warning' AND resolved_at IS NULL").bind(key).execute(&mut *tx).await?;
    }
    sqlx::query("INSERT INTO resource_state(id,sample,evaluation,collected_at) VALUES(true,$1,$2,now()) ON CONFLICT(id) DO UPDATE SET sample=EXCLUDED.sample,evaluation=EXCLUDED.evaluation,collected_at=now()").bind(sample).bind(json!(evaluations)).execute(&mut *tx).await?;
    sqlx::query("DELETE FROM resource_notifications WHERE id IN (SELECT id FROM resource_notifications WHERE kind='recovery' OR resolved_at IS NOT NULL ORDER BY created_at DESC OFFSET 500)").execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(())
}
pub(crate) fn start(a: App) {
    tokio::spawn(async move {
        let mut timer = tokio::time::interval(Duration::from_secs(5));
        timer.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            timer.tick().await;
            if tick(&a).await.is_err() {
                eprintln!("Resource monitoring sample could not be saved");
            }
        }
    });
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn holds_deduplicates_recovers_and_preserves_unknown() {
        let r = Rule {
            enabled: true,
            threshold_percent: 80.0,
        };
        let mut e = Evaluation::default();
        assert_eq!(evaluate(&mut e, Some(90.0), &r, 0.0, 10, 5.0), None);
        assert_eq!(evaluate(&mut e, Some(90.0), &r, 5.0, 10, 5.0), None);
        assert_eq!(
            evaluate(&mut e, Some(90.0), &r, 10.0, 10, 5.0),
            Some(Event::Warning)
        );
        assert_eq!(evaluate(&mut e, Some(99.0), &r, 15.0, 10, 5.0), None);
        assert_eq!(evaluate(&mut e, None, &r, 20.0, 10, 5.0), None);
        assert!(e.active);
        assert_eq!(evaluate(&mut e, Some(78.0), &r, 25.0, 10, 5.0), None);
        assert_eq!(
            evaluate(&mut e, Some(75.0), &r, 30.0, 10, 5.0),
            Some(Event::Recovery)
        );
        assert_eq!(evaluate(&mut e, Some(60.0), &r, 35.0, 10, 5.0), None);
    }
    #[test]
    fn missing_samples_restart_pending_hold() {
        let r = Rule {
            enabled: true,
            threshold_percent: 80.0,
        };
        let mut e = Evaluation::default();
        evaluate(&mut e, Some(90.0), &r, 0.0, 10, 5.0);
        evaluate(&mut e, None, &r, 5.0, 10, 5.0);
        assert_eq!(evaluate(&mut e, Some(90.0), &r, 10.0, 10, 5.0), None);
        assert_eq!(
            evaluate(&mut e, Some(90.0), &r, 20.0, 10, 5.0),
            Some(Event::Warning)
        );
    }
}
#[cfg(test)]
mod policy_tests {
    use super::*;
    #[test]
    fn raising_threshold_restarts_pending_hold() {
        let mut e = Evaluation::default();
        let a = Rule {
            enabled: true,
            threshold_percent: 80.0,
        };
        let b = Rule {
            enabled: true,
            threshold_percent: 95.0,
        };
        assert_eq!(evaluate(&mut e, Some(90.0), &a, 0.0, 10, 5.0), None);
        assert_eq!(evaluate(&mut e, Some(99.0), &b, 5.0, 10, 5.0), None);
        assert_eq!(evaluate(&mut e, Some(99.0), &b, 10.0, 10, 5.0), None);
        assert_eq!(
            evaluate(&mut e, Some(99.0), &b, 15.0, 10, 5.0),
            Some(Event::Warning)
        );
        let off = Rule {
            enabled: false,
            threshold_percent: 95.0,
        };
        assert_eq!(
            evaluate(&mut e, None, &off, 16.0, 10, 5.0),
            Some(Event::Recovery)
        );
        assert_eq!(evaluate(&mut e, None, &off, 17.0, 10, 5.0), None);
    }
}
