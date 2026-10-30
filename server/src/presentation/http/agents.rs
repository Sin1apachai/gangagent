use super::*;
#[derive(Deserialize)]
pub(crate) struct AgentForm {
    name: String,
    role: String,
    instructions: String,
    provider: String,
    model: Option<String>,
    office_placement: Option<String>,
    office_room_id: Option<String>,
    enabled: bool,
    version: Option<i32>,
    #[serde(default)]
    character_id: Option<i32>,
    #[serde(default)]
    birth_date: Option<String>,
}
pub(crate) fn check_agent(b: &AgentForm) -> Result<()> {
    if b.character_id.is_some_and(|c| !(0..12).contains(&c))
        || b.model
            .as_ref()
            .is_some_and(|m| !crate::model_selection::valid_id(&b.provider, m))
        || !valid(&b.name, 100)
        || !valid(&b.role, 200)
        || b.instructions.len() > 20000
        || !matches!(b.provider.as_str(), "codex" | "claude")
        || b.office_placement
            .as_deref()
            .is_some_and(|m| !matches!(m, "auto" | "common" | "room"))
        || b.office_room_id.as_ref().is_some_and(|id| !valid(id, 80))
    {
        Err(bad("Invalid agent fields or room selection"))
    } else {
        Ok(())
    }
}
pub(crate) async fn agents(
    State(a): State<App>,
    h: HeaderMap,
    Path(wid): Path<Uuid>,
) -> Result<Json<Vec<Value>>> {
    let u = user(&a, &h).await?;
    access(&a, &u, wid, false).await?;
    Ok(Json(sqlx::query_scalar("SELECT row_to_json(a) FROM agents a WHERE workspace_id=$1 AND deleted_at IS NULL ORDER BY created_at").bind(wid).fetch_all(&a.db).await?))
}
pub(crate) async fn create_agent(
    State(a): State<App>,
    h: HeaderMap,
    Path(wid): Path<Uuid>,
    Json(b): Json<AgentForm>,
) -> Result<Json<Value>> {
    let u = user(&a, &h).await?;
    access(&a, &u, wid, true).await?;
    check_agent(&b)?;
    let model = b.model.as_deref().filter(|s| !s.is_empty());
    crate::model_selection::validate_choice(&a, u.id, &b.provider, model.unwrap_or("")).await?;
    let id = Uuid::new_v4();
    let birth = b.birth_date.as_deref().unwrap_or("");
    let personality = master_data::generate(&a.db, id, birth).await?;
    let mut tx = a.db.begin().await?;
    organization::lock_workspace(&mut tx, wid).await?;
    let mode = b.office_placement.as_deref().unwrap_or("auto");
    validate_room(&mut tx, wid, mode, b.office_room_id.as_deref()).await?;
    sqlx::query("INSERT INTO agents(id,workspace_id,name,role,instructions,provider,enabled,character_id,birth_date,personality,office_placement,office_room_id,model) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)").bind(id).bind(wid).bind(&b.name).bind(&b.role).bind(&b.instructions).bind(&b.provider).bind(b.enabled).bind(b.character_id.unwrap_or(0)).bind(if birth.is_empty(){None}else{Some(birth)}).bind(personality).bind(mode).bind(&b.office_room_id).bind(model).execute(&mut *tx).await?;
    tx.commit().await?;
    audit(&a, &u, Some(wid), "agent.created").await?;
    Ok(Json(json!({"id":id})))
}
pub(crate) async fn edit_agent(
    State(a): State<App>,
    h: HeaderMap,
    Path((wid, id)): Path<(Uuid, Uuid)>,
    Json(b): Json<AgentForm>,
) -> Result<Json<Value>> {
    let u = user(&a, &h).await?;
    access(&a, &u, wid, true).await?;
    check_agent(&b)?;
    let old:Option<(Option<String>,Option<Value>)>=sqlx::query_as("SELECT birth_date,personality FROM agents WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL").bind(id).bind(wid).fetch_optional(&a.db).await?;
    let (old_birth, old_personality) = old.ok_or(bad("Agent unavailable"))?;
    let requested = b
        .birth_date
        .as_deref()
        .unwrap_or(old_birth.as_deref().unwrap_or(""));
    let personality = if Some(requested) == old_birth.as_deref() {
        old_personality
    } else {
        master_data::generate(&a.db, id, requested).await?
    };
    let (old_provider, old_model): (String, Option<String>) = sqlx::query_as(
        "SELECT provider,model FROM agents WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL",
    )
    .bind(id)
    .bind(wid)
    .fetch_one(&a.db)
    .await?;
    let model = if let Some(m) = b.model.as_deref() {
        if m.is_empty() {
            None
        } else {
            Some(m)
        }
    } else if old_provider == b.provider {
        old_model.as_deref()
    } else {
        None
    };
    if old_provider != b.provider || model != old_model.as_deref() {
        crate::model_selection::validate_choice(&a, u.id, &b.provider, model.unwrap_or("")).await?;
    }
    let mut tx = a.db.begin().await?;
    organization::lock_workspace(&mut tx, wid).await?;
    let old_room:Option<(String,Option<String>)>=sqlx::query_as("SELECT office_placement,office_room_id FROM agents WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL").bind(id).bind(wid).fetch_optional(&mut *tx).await?;
    let (old_mode, old_room) = old_room.ok_or(bad("Agent unavailable"))?;
    let mode = b.office_placement.as_deref().unwrap_or(&old_mode);
    let room = if b.office_placement.is_none() {
        old_room.as_deref()
    } else {
        b.office_room_id.as_deref()
    };
    validate_room(&mut tx, wid, mode, room).await?;
    let n=sqlx::query("UPDATE agents SET name=$1,role=$2,instructions=$3,provider=$4,enabled=$5,character_id=coalesce($9,character_id),birth_date=$10,personality=$11,office_placement=$12,office_room_id=$13,model=$14,version=version+1 WHERE id=$6 AND workspace_id=$7 AND version=$8 AND deleted_at IS NULL").bind(&b.name).bind(&b.role).bind(&b.instructions).bind(&b.provider).bind(b.enabled).bind(id).bind(wid).bind(b.version.ok_or(bad("Version required"))?).bind(b.character_id).bind(if requested.is_empty(){None}else{Some(requested)}).bind(personality).bind(mode).bind(room).bind(model).execute(&mut *tx).await?.rows_affected();
    tx.commit().await?;
    audit(&a, &u, Some(wid), "agent.updated").await?;
    changed(n)
}

async fn validate_room(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    wid: Uuid,
    mode: &str,
    room: Option<&str>,
) -> Result<()> {
    if mode != "room" {
        return if room.is_none() {
            Ok(())
        } else {
            Err(bad("Select a room only in room mode"))
        };
    }
    let id = room.ok_or(bad("Choose an office room"))?;
    let exists:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM workspaces w CROSS JOIN LATERAL jsonb_array_elements(coalesce(w.layout->'rooms','[]'::jsonb)) r WHERE w.id=$1 AND r->>'id'=$2)").bind(wid).bind(id).fetch_one(&mut **tx).await?;
    if exists {
        Ok(())
    } else {
        Err(bad("Room is unavailable in this workspace"))
    }
}
