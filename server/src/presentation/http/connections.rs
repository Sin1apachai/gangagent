use super::*;
pub(crate) async fn connections(State(a): State<App>, h: HeaderMap) -> Result<Json<Value>> {
    let u = user(&a, &h).await?;
    let settings: Vec<Value> =
        sqlx::query_scalar("SELECT row_to_json(c) FROM provider_connections c WHERE user_id=$1")
            .bind(u.id)
            .fetch_all(&a.db)
            .await?;
    let workers:Vec<Value>=sqlx::query_scalar("SELECT json_build_object('id',id,'mode',mode,'providers',providers,'heartbeat_at',heartbeat_at,'online',heartbeat_at>now()-interval '20 seconds') FROM workers WHERE user_id=$1").bind(u.id).fetch_all(&a.db).await?;
    sqlx::query("UPDATE provider_logins SET status='expired',login_url='',device_code='' WHERE user_id=$1 AND expires_at<=now() AND status IN ('queued','starting','waiting')").bind(u.id).execute(&a.db).await?;
    let logins:Vec<Value> = sqlx::query_scalar("SELECT json_build_object('id',id,'provider',provider,'status',status,'login_url',login_url,'device_code',device_code,'message',message,'expires_at',expires_at) FROM provider_logins WHERE user_id=$1 ORDER BY created_at DESC LIMIT 10").bind(u.id).fetch_all(&a.db).await?;
    let global_intelligence: bool = sqlx::query_scalar(
        "SELECT $1 OR EXISTS(SELECT 1 FROM intelligence_grants WHERE user_id=$2)",
    )
    .bind(u.is_super_admin)
    .bind(u.id)
    .fetch_one(&a.db)
    .await?;
    Ok(Json(
        json!({"global_intelligence":global_intelligence,"logins":logins,"settings":settings,"workers":workers,"api_fallback":false,"billing_notice":"Subscription mode does not override provider-side extra-credit settings. Disable paid usage/auto reload in both provider accounts before enabling execution."}),
    ))
}
#[derive(Deserialize)]
pub(crate) struct ConnectionForm {
    enabled: bool,
    billing_acknowledged: bool,
}
pub(crate) async fn connection(
    State(a): State<App>,
    h: HeaderMap,
    Path(provider): Path<String>,
    Json(b): Json<ConnectionForm>,
) -> Result<Json<Value>> {
    let u = user(&a, &h).await?;
    if !matches!(provider.as_str(), "codex" | "claude") || b.enabled && !b.billing_acknowledged {
        return Err(bad(
            "Select a supported provider and acknowledge billing settings",
        ));
    }
    let mut tx = a.db.begin().await?;
    sqlx::query("INSERT INTO provider_connections(user_id,provider,enabled,billing_acknowledged) VALUES($1,$2,$3,$4) ON CONFLICT(user_id,provider) DO UPDATE SET enabled=EXCLUDED.enabled,billing_acknowledged=EXCLUDED.billing_acknowledged").bind(u.id).bind(&provider).bind(b.enabled).bind(b.billing_acknowledged).execute(&mut *tx).await?;
    if !b.enabled {
        invalidate_execution(&mut tx, None, Some(u.id), Some(&provider)).await?;
    }
    tx.commit().await?;
    audit(&a, &u, None, &format!("connection.{provider}.updated")).await?;
    Ok(Json(json!({"ok":true})))
}
