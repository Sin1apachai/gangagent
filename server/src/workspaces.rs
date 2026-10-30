use super::*;
pub(crate) async fn workspaces(State(a): State<App>, h: HeaderMap) -> Result<Json<Vec<Value>>> {
    let u = user(&a, &h).await?;
    Ok(Json(sqlx::query_scalar("SELECT json_build_object('id',w.id,'name',w.name,'version',w.version,'role',CASE WHEN $2 THEN 'super_admin' ELSE m.role END) FROM workspaces w LEFT JOIN memberships m ON m.workspace_id=w.id AND m.user_id=$1 WHERE w.deleted_at IS NULL AND ($2 OR m.user_id IS NOT NULL) ORDER BY w.created_at")
 .bind(u.id).bind(u.is_super_admin).fetch_all(&a.db).await?))
}
#[derive(Deserialize)]
pub(crate) struct Name {
    name: String,
}
pub(crate) async fn create_workspace(
    State(a): State<App>,
    h: HeaderMap,
    Json(b): Json<Name>,
) -> Result<Json<Value>> {
    let u = user(&a, &h).await?;
    if !valid(&b.name, 100) {
        return Err(bad("Name must be 1–100 bytes"));
    }
    let id = Uuid::new_v4();
    let mut tx = a.db.begin().await?;
    sqlx::query("INSERT INTO workspaces(id,name) VALUES($1,$2)")
        .bind(id)
        .bind(b.name.trim())
        .execute(&mut *tx)
        .await?;
    sqlx::query("INSERT INTO memberships VALUES($1,$2,'owner')")
        .bind(id)
        .bind(u.id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(Json(json!({"id":id,"name":b.name})))
}
pub(crate) async fn snapshot(
    State(a): State<App>,
    h: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>> {
    let u = user(&a, &h).await?;
    access(&a, &u, id, false).await?;
    let value:Value=sqlx::query_scalar("SELECT json_build_object('id',id,'name',name,'version',version,'agents',COALESCE((SELECT json_agg(a ORDER BY a.created_at) FROM agents a WHERE workspace_id=w.id AND deleted_at IS NULL),'[]'::json),'layout',layout,'layout_version',layout_version,'tasks',COALESCE((SELECT json_agg(t ORDER BY t.created_at DESC) FROM tasks t WHERE workspace_id=w.id AND deleted_at IS NULL),'[]'::json),'knowledge',COALESCE((SELECT json_agg(k ORDER BY k.created_at DESC) FROM knowledge k WHERE workspace_id=w.id AND deleted_at IS NULL),'[]'::json)) FROM workspaces w WHERE id=$1").bind(id).fetch_one(&a.db).await?;
    Ok(Json(value))
}
#[derive(Deserialize)]
pub(crate) struct KnowledgeInput {
    title: String,
    content: String,
    source: String,
    #[serde(default)]
    verified: bool,
}
pub(crate) async fn knowledge(
    State(a): State<App>,
    h: HeaderMap,
    Path(wid): Path<Uuid>,
    Json(b): Json<KnowledgeInput>,
) -> Result<Json<Value>> {
    let u = user(&a, &h).await?;
    access(&a, &u, wid, true).await?;
    if !valid(&b.title, 200) || !valid(&b.content, 50000) || b.source.len() > 2000 {
        return Err(bad("Invalid knowledge entry"));
    }
    let id = Uuid::new_v4();
    sqlx::query("INSERT INTO knowledge(id,workspace_id,title,content,source,created_by,verified) VALUES($1,$2,$3,$4,$5,$6,$7)").bind(id).bind(wid).bind(b.title).bind(b.content).bind(b.source).bind(u.id).bind(b.verified).execute(&a.db).await?;
    Ok(Json(json!({"id":id})))
}
#[derive(Serialize, Deserialize, Clone)]
pub(crate) struct Item {
    pub(crate) id: String,
    pub(crate) kind: String,
    pub(crate) x: i32,
    pub(crate) y: i32,
    pub(crate) rotation: i32,
}
#[derive(Serialize, Deserialize, Clone)]
#[serde(deny_unknown_fields)]
pub(crate) struct Room {
    id: String,
    name: String,
    department: String,
    purpose: String,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
    door_side: String,
    door_offset: i32,
}
impl Room {
    fn contains(&self, x: i32, y: i32) -> bool {
        x >= self.x && x < self.x + self.width && y >= self.y && y < self.y + self.height
    }
    fn door(&self) -> ((i32, i32), (i32, i32)) {
        match self.door_side.as_str() {
            "north" => (
                (self.x + self.door_offset, self.y),
                (self.x + self.door_offset, self.y - 1),
            ),
            "south" => (
                (self.x + self.door_offset, self.y + self.height - 1),
                (self.x + self.door_offset, self.y + self.height),
            ),
            "west" => (
                (self.x, self.y + self.door_offset),
                (self.x - 1, self.y + self.door_offset),
            ),
            _ => (
                (self.x + self.width - 1, self.y + self.door_offset),
                (self.x + self.width, self.y + self.door_offset),
            ),
        }
    }
}
#[derive(Serialize, Deserialize, Clone)]
pub(crate) struct Layout {
    pub(crate) items: Vec<Item>,
    #[serde(default)]
    pub(crate) rooms: Vec<Room>,
}
#[derive(Deserialize)]
pub(crate) struct LayoutInput {
    version: i32,
    layout: Layout,
}
pub(crate) fn valid_layout(l: &Layout) -> bool {
    if l.items.len() > 150 {
        return false;
    }
    let mut cells = std::collections::HashSet::new();
    let mut ids = std::collections::HashSet::new();
    let furniture_valid = l.items.iter().all(|i| {
        if !(0..20).contains(&i.x)
            || !(0..12).contains(&i.y)
            || !valid(&i.id, 80)
            || !ids.insert(&i.id)
            || !matches!(i.rotation, 0 | 90 | 180 | 270)
        {
            return false;
        }
        let (mut w, mut h) = match i.kind.as_str() {
            "desk" | "sofa" | "bookshelf" | "board" => (2, 1),
            "meeting" | "rug" => (3, 2),
            "plant" | "lamp" | "chair" | "computer" | "wall" | "coffee" => (1, 1),
            _ => return false,
        };
        if i.rotation % 180 != 0 {
            std::mem::swap(&mut w, &mut h);
        }
        (0..w).all(|dx| {
            (0..h).all(|dy| {
                (0..20).contains(&(i.x + dx))
                    && (0..12).contains(&(i.y + dy))
                    && cells.insert((i.x + dx, i.y + dy))
            })
        })
    });
    if !furniture_valid || l.rooms.len() > 20 {
        return false;
    }
    let mut room_ids = std::collections::HashSet::new();
    let mut departments = std::collections::HashSet::new();
    for (index, r) in l.rooms.iter().enumerate() {
        if !valid(&r.id, 80)
            || !room_ids.insert(&r.id)
            || !valid(&r.name, 100)
            || r.department.len() > 100
            || r.purpose.len() > 500
            || r.width < 3
            || r.width > 20
            || r.height < 3
            || r.height > 12
            || r.x < 0
            || r.y < 0
            || r.x > 20 - r.width
            || r.y > 12 - r.height
            || !matches!(r.door_side.as_str(), "north" | "south" | "east" | "west")
        {
            return false;
        }
        if !r.department.trim().is_empty()
            && !departments.insert(r.department.trim().to_lowercase())
        {
            return false;
        }
        let length = if matches!(r.door_side.as_str(), "north" | "south") {
            r.width
        } else {
            r.height
        };
        if r.door_offset < 0 || r.door_offset >= length {
            return false;
        }
        let (inside, outside) = r.door();
        if outside.0 < 0
            || outside.0 >= 20
            || outside.1 < 0
            || outside.1 >= 12
            || cells.contains(&inside)
            || cells.contains(&outside)
        {
            return false;
        }
        for other in &l.rooms[..index] {
            // Keep a one-tile shared corridor between rooms.
            if r.x <= other.x + other.width
                && other.x <= r.x + r.width
                && r.y <= other.y + other.height
                && other.y <= r.y + r.height
            {
                return false;
            }
        }
        for i in &l.items {
            let (mut w, mut h) = match i.kind.as_str() {
                "desk" | "sofa" | "bookshelf" | "board" => (2, 1),
                "meeting" | "rug" => (3, 2),
                _ => (1, 1),
            };
            if i.rotation % 180 != 0 {
                std::mem::swap(&mut w, &mut h);
            }
            let n = (0..w)
                .flat_map(|dx| (0..h).map(move |dy| (i.x + dx, i.y + dy)))
                .filter(|(x, y)| r.contains(*x, *y))
                .count();
            if n > 0 && n != (w * h) as usize {
                return false;
            }
        }
    }
    true
}
pub(crate) async fn layout(
    State(a): State<App>,
    h: HeaderMap,
    Path(wid): Path<Uuid>,
    Json(b): Json<LayoutInput>,
) -> Result<Json<Value>> {
    let u = user(&a, &h).await?;
    access(&a, &u, wid, true).await?;
    if !valid_layout(&b.layout) {
        return Err(bad(
            "Invalid layout: check room spacing, doors and furniture",
        ));
    }
    let mut tx = a.db.begin().await?;
    organization::lock_workspace(&mut tx, wid).await?;
    let version:Option<i32>=sqlx::query_scalar("UPDATE workspaces SET layout=$1,layout_version=layout_version+1 WHERE id=$2 AND layout_version=$3 RETURNING layout_version").bind(sqlx::types::Json(b.layout)).bind(wid).bind(b.version).fetch_optional(&mut *tx).await?;
    if version.is_some() {
        sqlx::query("UPDATE agents a SET office_placement='auto',office_room_id=NULL,version=version+1 WHERE workspace_id=$1 AND office_placement='room' AND NOT EXISTS(SELECT 1 FROM workspaces w CROSS JOIN LATERAL jsonb_array_elements(coalesce(w.layout->'rooms','[]'::jsonb)) r WHERE w.id=a.workspace_id AND r->>'id'=a.office_room_id)").bind(wid).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    match version {
        Some(v) => Ok(Json(json!({"version":v}))),
        None => Err(Error(
            StatusCode::CONFLICT,
            "Layout changed elsewhere; reload before saving",
        )),
    }
}
