use super::*;
#[derive(Deserialize)]
pub(crate) struct NoteForm {
    title: String,
    content: String,
    source: String,
    verified: bool,
    version: i32,
}
pub(crate) async fn edit_knowledge(
    State(a): State<App>,
    h: HeaderMap,
    Path((wid, id)): Path<(Uuid, Uuid)>,
    Json(b): Json<NoteForm>,
) -> Result<Json<Value>> {
    let u = user(&a, &h).await?;
    access(&a, &u, wid, true).await?;
    if !valid(&b.title, 200) || !valid(&b.content, 50000) || b.source.len() > 2000 {
        return Err(bad("Invalid knowledge entry"));
    }
    let n=sqlx::query("UPDATE knowledge SET title=$1,content=$2,source=$3,verified=$4,version=version+1 WHERE id=$5 AND workspace_id=$6 AND version=$7 AND deleted_at IS NULL").bind(b.title).bind(b.content).bind(b.source).bind(b.verified).bind(id).bind(wid).bind(b.version).execute(&a.db).await?.rows_affected();
    audit(&a, &u, Some(wid), "knowledge.updated").await?;
    changed(n)
}
