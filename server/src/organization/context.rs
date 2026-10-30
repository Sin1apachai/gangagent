use super::*;
pub(crate) async fn validate_reviewer(
    tx: &mut Transaction<'_, Postgres>,
    wid: Uuid,
    id: Uuid,
) -> Result<()> {
    let eligible:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM users u WHERE u.id=$1 AND u.deleted_at IS NULL AND (u.is_super_admin OR EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=u.id AND m.workspace_id=$2 AND m.role IN ('owner','member'))))").bind(id).bind(wid).fetch_one(&mut **tx).await?;
    if !eligible {
        Err(bad("Reviewer must be an active workspace writer"))
    } else {
        Ok(())
    }
}
pub(crate) async fn freeze_context(
    tx: &mut Transaction<'_, Postgres>,
    wid: Uuid,
    agent: Option<Uuid>,
    required: &[Uuid],
    contract: Option<Value>,
) -> Result<Value> {
    let mut context = json!({"schema":1,"agent":null,"skills":[],"workflow":contract});
    if let Some(id) = agent {
        let row:Option<Value>=sqlx::query_scalar("SELECT json_build_object('id',id,'name',name,'role',role,'instructions',instructions,'department',department,'responsibilities',responsibilities,'decision_scope',decision_scope,'manager_id',manager_id,'agent_version',version,'birth_date',birth_date,'personality',personality) FROM agents WHERE id=$1 AND workspace_id=$2 AND enabled AND deleted_at IS NULL").bind(id).bind(wid).fetch_optional(&mut **tx).await?;
        context["agent"] = row.ok_or(bad("Agent unavailable"))?;
        let all: i64 = sqlx::query_scalar("SELECT count(*) FROM agent_skills WHERE agent_id=$1")
            .bind(id)
            .fetch_one(&mut **tx)
            .await?;
        let skills:Vec<Value>=sqlx::query_scalar("SELECT to_jsonb(v) FROM agent_skills b JOIN skills s ON s.id=b.skill_id JOIN skill_versions v ON v.skill_id=s.id AND v.version=coalesce(b.pinned_version,s.version) WHERE b.agent_id=$1 AND s.workspace_id=$2 AND s.deleted_at IS NULL ORDER BY s.id").bind(id).bind(wid).fetch_all(&mut **tx).await?;
        if skills.len() != all as usize {
            return Err(bad(
                "An assigned skill is archived or unavailable; update the agent first",
            ));
        }
        for skill in required {
            if !skills
                .iter()
                .any(|s| s["skill_id"].as_str() == Some(skill.to_string().as_str()))
            {
                return Err(bad("Workflow requires a skill not assigned to this agent"));
            }
        }
        context["skills"] = json!(skills);
    } else if !required.is_empty() {
        return Err(bad("Required skills need an assigned agent"));
    }
    if serde_json::to_vec(&context)
        .map_err(|_| bad("Invalid execution context"))?
        .len()
        > 80000
    {
        return Err(bad("Agent/skill context exceeds 80KB; reduce instructions"));
    }
    Ok(context)
}
