//! Accepted work becomes workspace knowledge without another model call.
use super::*;
use sqlx::{Postgres, Transaction};
#[derive(Serialize)]
pub(crate) struct Saved {
    pub(crate) id: Uuid,
    pub(crate) action: &'static str,
}
fn prefix(s: &str, limit: usize) -> String {
    let mut end = s.len().min(limit);
    while !s.is_char_boundary(end) {
        end -= 1;
    }
    s[..end].to_string()
}
fn identity(scope: &str, file: Option<&str>, task: Uuid) -> String {
    match file {
        Some(file) => format!("{scope}:file:{:x}", Sha256::digest(file.as_bytes())),
        None => format!("task:{task}:summary"),
    }
}
fn content(text: &str, task: Uuid, file: Option<&str>) -> String {
    let selected = if file.is_some() {
        text.to_string()
    } else {
        text.split("\n\n").take(3).collect::<Vec<_>>().join("\n\n")
    };
    let limit = if file.is_some() { 47000 } else { 4000 };
    let clipped = prefix(&selected, limit);
    format!(
        "{}{}\n\n---\nตรวจรับจากงาน {}{}\nอ่านผลและไฟล์ฉบับเต็มได้จากงานต้นทาง",
        clipped,
        if selected.len() > limit {
            "\n\n[เก็บข้อความบางส่วนตามขนาด Knowledge; ดูต้นฉบับในงานอ้างอิง]"
        } else {
            ""
        },
        task,
        file.map(|f| format!(" · ไฟล์ {f}")).unwrap_or_default()
    )
}
pub(crate) async fn save(
    tx: &mut Transaction<'_, Postgres>,
    wid: Uuid,
    task: Uuid,
    uid: Uuid,
) -> Result<Saved> {
    let (title,result,project,plan,run,contract):(String,String,Option<Uuid>,Option<Uuid>,Option<Uuid>,Option<Value>)=sqlx::query_as("SELECT title,result,project_id,plan_id,current_run_id,workflow_step FROM tasks WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL AND status='done' AND review_for_task_id IS NULL").bind(task).bind(wid).fetch_optional(&mut **tx).await?.ok_or(bad("Accept the task before saving automatic knowledge"))?;
    let run = run.ok_or(bad("Accepted task has no source run"))?;
    let names: Vec<String> = sqlx::query_scalar(
        "SELECT name FROM artifacts WHERE task_id=$1 AND run_id=$2 ORDER BY name",
    )
    .bind(task)
    .bind(run)
    .fetch_all(&mut **tx)
    .await?;
    let mut candidates = contract
        .as_ref()
        .and_then(|c| c["required_files"].as_array())
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(String::from)
        .filter(|n| names.contains(n))
        .collect::<Vec<_>>();
    for name in names {
        if !candidates.contains(&name) {
            candidates.push(name);
        }
    }
    let root = std::path::Path::new("/data/runs").join(run.to_string());
    let mut document = None;
    for name in candidates {
        if name == "result.md"
            || name.starts_with("inputs/")
            || name.starts_with("references/")
            || !phase2::safe_relative(&name)
            || !name.to_lowercase().ends_with(".md")
        {
            continue;
        }
        let Ok(base) = tokio::fs::canonicalize(&root).await else {
            continue;
        };
        let Ok(path) = tokio::fs::canonicalize(base.join(&name)).await else {
            continue;
        };
        if !path.starts_with(&base) {
            continue;
        }
        let Ok(meta) = tokio::fs::metadata(&path).await else {
            continue;
        };
        if !meta.is_file() || meta.len() > 1024 * 1024 {
            continue;
        }
        if let Ok(text) = tokio::fs::read_to_string(path).await {
            if !text.trim().is_empty() && !text.contains('\0') {
                document = Some((name, text));
                break;
            }
        }
    }
    let scope = project
        .map(|id| format!("project:{id}"))
        .or_else(|| plan.map(|id| format!("plan:{id}")))
        .unwrap_or_else(|| format!("task:{task}"));
    let file = document.as_ref().map(|d| d.0.as_str());
    let key = identity(&scope, file, task);
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))")
        .bind(format!("knowledge-auto:{wid}:{key}"))
        .execute(&mut **tx)
        .await?;
    let existing:Option<(Uuid,i32,Option<Uuid>)>=sqlx::query_as("SELECT id,version,origin_run_id FROM knowledge WHERE workspace_id=$1 AND auto_key=$2 AND deleted_at IS NULL FOR UPDATE").bind(wid).bind(&key).fetch_optional(&mut **tx).await?;
    if let Some((id, _, Some(old_run))) = existing {
        let newer:bool=sqlx::query_scalar("SELECT (SELECT started_at FROM task_runs WHERE id=$1) > (SELECT started_at FROM task_runs WHERE id=$2)").bind(run).bind(old_run).fetch_one(&mut **tx).await?;
        if old_run == run || !newer {
            return Ok(Saved {
                id,
                action: "unchanged",
            });
        }
    }
    let note_title = prefix(
        &format!(
            "{}{}",
            title,
            file.map(|f| format!(" — {f}")).unwrap_or_default()
        ),
        200,
    );
    let body = content(
        document.as_ref().map(|d| d.1.as_str()).unwrap_or(&result),
        task,
        file,
    );
    let source = format!(
        "ตรวจรับงาน {task} · รอบ {run}{}",
        file.map(|f| format!(" · {f}")).unwrap_or_default()
    );
    let saved = if let Some((id, version, _)) = existing {
        sqlx::query("UPDATE knowledge SET title=$1,content=$2,source=$3,verified=true,version=version+1,origin_task_id=$4,origin_run_id=$5 WHERE id=$6 AND version=$7").bind(note_title).bind(body).bind(source).bind(task).bind(run).bind(id).bind(version).execute(&mut **tx).await?;
        Saved {
            id,
            action: "updated",
        }
    } else {
        let id = Uuid::new_v4();
        sqlx::query("INSERT INTO knowledge(id,workspace_id,title,content,source,created_by,verified,auto_key,origin_task_id,origin_run_id) VALUES($1,$2,$3,$4,$5,$6,true,$7,$8,$9)").bind(id).bind(wid).bind(note_title).bind(body).bind(source).bind(uid).bind(key).bind(task).bind(run).execute(&mut **tx).await?;
        Saved {
            id,
            action: "created",
        }
    };
    sqlx::query("INSERT INTO audit_events(user_id,workspace_id,action) VALUES($1,$2,$3)")
        .bind(uid)
        .bind(wid)
        .bind(format!("knowledge.auto_{}:{}", saved.action, saved.id))
        .execute(&mut **tx)
        .await?;
    sqlx::query("INSERT INTO task_events(task_id,message) VALUES($1,$2)")
        .bind(task)
        .bind(format!("Knowledge {}: {}", saved.action, saved.id))
        .execute(&mut **tx)
        .await?;
    Ok(saved)
}
pub(crate) fn routes() -> Router<App> {
    Router::new()
        .route("/workspaces/{wid}/tasks/{id}/knowledge", post(sync))
        .route("/workspaces/{wid}/knowledge/{id}/history", get(history))
}
async fn sync(
    State(a): State<App>,
    h: HeaderMap,
    Path((wid, id)): Path<(Uuid, Uuid)>,
) -> Result<Json<Value>> {
    let u = user(&a, &h).await?;
    access(&a, &u, wid, true).await?;
    let mut tx = a.db.begin().await?;
    organization::lock_workspace(&mut tx, wid).await?;
    let saved = save(&mut tx, wid, id, u.id).await?;
    tx.commit().await?;
    Ok(Json(json!(saved)))
}
async fn history(
    State(a): State<App>,
    h: HeaderMap,
    Path((wid, id)): Path<(Uuid, Uuid)>,
) -> Result<Json<Value>> {
    let u = user(&a, &h).await?;
    access(&a, &u, wid, false).await?;
    let rows:Vec<Value>=sqlx::query_scalar("SELECT to_jsonb(v) FROM knowledge_versions v JOIN knowledge k ON k.id=v.note_id WHERE k.id=$1 AND k.workspace_id=$2 ORDER BY v.version DESC LIMIT 30").bind(id).bind(wid).fetch_all(&a.db).await?;
    if rows.is_empty() {
        return Err(Error(StatusCode::NOT_FOUND, "Knowledge history not found"));
    }
    Ok(Json(json!(rows)))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn identity_is_scoped_and_does_not_match_similar_titles() {
        let t = Uuid::new_v4();
        assert_ne!(
            identity("project:a", Some("requirements.md"), t),
            identity("project:b", Some("requirements.md"), t)
        );
        assert_eq!(
            identity("project:a", Some("requirements.md"), t),
            identity("project:a", Some("requirements.md"), Uuid::new_v4())
        );
        assert_ne!(
            identity("task:a", None, t),
            identity("task:b", None, Uuid::new_v4())
        );
    }
    #[test]
    fn unicode_content_is_bounded_and_carries_provenance() {
        let t = Uuid::new_v4();
        let text = "ก".repeat(30000);
        let output = content(&text, t, Some("requirements.md"));
        assert!(output.len() < 49000);
        assert!(output.contains(&t.to_string()));
        assert!(output.contains("เก็บข้อความบางส่วน"));
        assert!(content("one\n\ntwo\n\nthree\n\nfour", t, None)
            .starts_with("one\n\ntwo\n\nthree\n\n---"));
    }
}
