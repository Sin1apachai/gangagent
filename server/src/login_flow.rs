use super::*;
use tokio::sync::mpsc;

fn clean_output(raw: &str) -> String {
    let mut out = String::new();
    let mut escape = false;
    for c in raw.chars() {
        if c == '\u{1b}' {
            escape = true;
            continue;
        }
        if escape {
            if c.is_ascii_alphabetic() {
                escape = false;
            }
            continue;
        }
        if !c.is_control() || c == '\n' {
            out.push(c);
        }
    }
    out
}
fn login_details(provider: &str, output: &str) -> (String, String) {
    let clean = clean_output(output);
    let url = clean
        .split_whitespace()
        .map(|s| s.trim_matches(|c: char| matches!(c, '"' | '\'' | '(' | ')' | '<' | '>' | ',')))
        .find(|s| {
            if provider == "codex" {
                *s == "https://auth.openai.com/codex/device" || *s == "https://chatgpt.com/device"
            } else {
                s.starts_with("https://claude.ai/oauth/authorize?")
                    || s.starts_with("https://claude.com/cai/oauth/authorize?")
            }
        })
        .unwrap_or("")
        .to_owned();
    let code = if provider == "codex" && !url.is_empty() {
        clean
            .split_whitespace()
            .find(|s| {
                let parts: Vec<&str> = s.split('-').collect();
                parts.len() == 2
                    && parts.iter().all(|p| {
                        (3..=5).contains(&p.len())
                            && p.bytes()
                                .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit())
                    })
            })
            .unwrap_or("")
            .to_owned()
    } else {
        String::new()
    };
    (url, code)
}
async fn stream<R: tokio::io::AsyncRead + Unpin>(mut r: R, tx: mpsc::Sender<Vec<u8>>) {
    let mut buffer = [0u8; 2048];
    while let Ok(n) = r.read(&mut buffer).await {
        if n == 0 || tx.send(buffer[..n].to_vec()).await.is_err() {
            break;
        }
    }
}
async fn finish_login(db: &PgPool, id: Uuid, status: &str, message: &str) -> WorkerResult<()> {
    if status == "completed" {
        sqlx::query("UPDATE provider_connections c SET reauth_required=false FROM provider_logins l WHERE l.id=$1 AND c.user_id=l.user_id AND c.provider=l.provider").bind(id).execute(db).await?;
    }
    sqlx::query("UPDATE provider_logins SET status=$2,login_url='',device_code='',message=$3 WHERE id=$1 AND status IN ('starting','waiting')")
        .bind(id).bind(status).bind(message).execute(db).await?;
    Ok(())
}
pub(super) async fn handle(
    db: &PgPool,
    uid: Uuid,
    worker: &str,
    fixture: bool,
) -> WorkerResult<bool> {
    let next:Option<(Uuid,String,bool)> = sqlx::query_as("UPDATE provider_logins SET status='starting' WHERE id=(SELECT l.id FROM provider_logins l JOIN users u ON u.id=l.user_id WHERE l.worker_id=$1 AND l.user_id=$2 AND l.status='queued' AND l.expires_at>now() AND u.deleted_at IS NULL ORDER BY l.created_at FOR UPDATE OF l SKIP LOCKED LIMIT 1) RETURNING id,provider,reconnect")
        .bind(worker).bind(uid).fetch_optional(db).await?;
    let Some((id, provider, reconnect)) = next else {
        return Ok(false);
    };
    // Never replace a working session just because an old page requested login.
    let reauth:bool=sqlx::query_scalar("SELECT COALESCE((SELECT reauth_required FROM provider_connections WHERE user_id=$1 AND provider=$2),false)").bind(uid).bind(&provider).fetch_one(db).await?;
    if !fixture && !reconnect && !reauth && auth(&provider, false).await.authenticated {
        finish_login(db, id, "completed", "Already connected").await?;
        return Ok(true);
    }
    if fixture {
        sqlx::query("UPDATE provider_logins SET status='waiting',login_url=$2,device_code=$3,message='Fixture only; no authentication request was sent' WHERE id=$1")
            .bind(id).bind(if provider=="codex"{"https://auth.openai.com/codex/device"}else{"https://claude.ai/oauth/authorize?fixture=true"})
            .bind(if provider=="codex"{"TEST-ONLY"}else{""}).execute(db).await?;
        return Ok(true);
    }
    let outcome = run_login(db, uid, worker, id, &provider).await;
    if outcome.is_err() {
        finish_login(db, id, "failed", "Sign-in could not finish. Please retry.").await?;
    }
    Ok(true)
}
async fn run_login(
    db: &PgPool,
    uid: Uuid,
    worker: &str,
    id: Uuid,
    provider: &str,
) -> WorkerResult<()> {
    let mut command = child(provider, FsPath::new("/home/office"));
    if provider == "codex" {
        command.args([
            "login",
            "--device-auth",
            "-c",
            "cli_auth_credentials_store=\"file\"",
            "-c",
            "forced_login_method=\"chatgpt\"",
        ]);
    } else {
        command.args(["auth", "login", "--claudeai"]);
    }
    command.stdin(Stdio::piped());
    let mut process = command.spawn()?;
    let _guard = GroupGuard(process.id().unwrap_or(0));
    let mut input = process.stdin.take().ok_or("Login stdin unavailable")?;
    let (tx, mut rx) = mpsc::channel(16);
    let out = tokio::spawn(stream(
        process.stdout.take().ok_or("Login stdout unavailable")?,
        tx.clone(),
    ));
    let err = tokio::spawn(stream(
        process.stderr.take().ok_or("Login stderr unavailable")?,
        tx,
    ));
    let mut output = Vec::new();
    let redis =
        redis::Client::open(std::env::var("REDIS_URL").unwrap_or("redis://redis:6379".into()))?;
    let mut redis = redis.get_multiplexed_async_connection().await?;
    let key = format!("provider-login-input:{uid}:{id}");
    let mut sent = false;
    let start = Instant::now();
    let mut tick = tokio::time::interval(Duration::from_millis(500));
    let mut streams_open = true;
    loop {
        tokio::select! {
            chunk=rx.recv(), if streams_open => {
                if let Some(chunk)=chunk {
                    if output.len()+chunk.len()>32768 { break; }
                    output.extend(chunk);
                    let (url,code)=login_details(provider,&String::from_utf8_lossy(&output));
                    if !url.is_empty() {
                        sqlx::query("UPDATE provider_logins SET status='waiting',login_url=$2,device_code=$3 WHERE id=$1 AND status IN ('starting','waiting')")
                            .bind(id).bind(url).bind(code).execute(db).await?;
                    }
                } else { streams_open = false; }
            },
            result=process.wait()=>{
                let success=result?.success() && auth(provider,false).await.authenticated;
                finish_login(db,id,if success{"completed"}else{"failed"},if success{"Connected"}else{"Sign-in was not completed. Check account permissions and retry."}).await?;
                break;
            },
            _=tick.tick()=>{
                sqlx::query("UPDATE workers SET heartbeat_at=now() WHERE id=$1").bind(worker).execute(db).await?;
                let active:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM provider_logins l JOIN users u ON u.id=l.user_id WHERE l.id=$1 AND l.user_id=$2 AND l.status IN ('starting','waiting') AND l.expires_at>now() AND u.deleted_at IS NULL)").bind(id).bind(uid).fetch_one(db).await?;
                if !active || start.elapsed()>Duration::from_secs(600) { break; }
                if provider=="claude" && !sent {
                    let code:Option<String>=redis::cmd("GETDEL").arg(&key).query_async(&mut redis).await?;
                    if let Some(code)=code {
                        tokio::time::timeout(Duration::from_secs(5),input.write_all(format!("{}\n",code.trim()).as_bytes())).await??;
                        sent=true;
                    }
                }
            }
        }
    }
    drop(_guard);
    let _ = process.wait().await;
    out.abort();
    err.abort();
    let _: i64 = redis::cmd("DEL").arg(key).query_async(&mut redis).await?;
    finish_login(db, id, "expired", "Sign-in ended or expired; try again").await?;
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn extracts_only_official_login_details() {
        assert_eq!(
            login_details(
                "codex",
                "\u{1b}[32mhttps://auth.openai.com/codex/device\u{1b}[0m\nABCD-1234"
            ),
            (
                "https://auth.openai.com/codex/device".into(),
                "ABCD-1234".into()
            )
        );
        assert!(
            login_details("codex", "https://evil.test/codex/device ABCD-1234")
                .0
                .is_empty()
        );
        assert!(
            login_details("claude", "https://claude.ai.evil.test/oauth/authorize?x")
                .0
                .is_empty()
        );
        assert_eq!(
            login_details(
                "claude",
                "https://claude.com/cai/oauth/authorize?state=test"
            )
            .0,
            "https://claude.com/cai/oauth/authorize?state=test"
        );
        assert!(login_details(
            "claude",
            "https://claude.com.evil.test/cai/oauth/authorize?x"
        )
        .0
        .is_empty());
        assert_eq!(
            login_details(
                "claude",
                "Sign in at: https://claude.ai/oauth/authorize?state=test"
            )
            .0,
            "https://claude.ai/oauth/authorize?state=test"
        );
    }
}
