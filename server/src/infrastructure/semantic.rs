use super::*;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpStream,
};
const MODEL: &str = "paraphrase-multilingual-MiniLM-L12-v2";
async fn embed(texts: &[String]) -> Option<Vec<Vec<f64>>> {
    let address = std::env::var("EMBEDDING_ADDR").ok()?;
    if address.is_empty() {
        return None;
    }
    tokio::time::timeout(std::time::Duration::from_secs(30),async{
  let body=serde_json::to_vec(&json!({"texts":texts})).ok()?;
  let mut stream=TcpStream::connect(&address).await.ok()?;
  let header=format!("POST /embed HTTP/1.0\r\nHost: embeddings\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",body.len());
  stream.write_all(header.as_bytes()).await.ok()?;stream.write_all(&body).await.ok()?;
  let mut response=Vec::new();stream.take(1024*1024).read_to_end(&mut response).await.ok()?;
  let split=response.windows(4).position(|p|p==b"\r\n\r\n")?;if !String::from_utf8_lossy(&response[..split]).lines().next()?.contains(" 200 "){return None;}
  let value:Value=serde_json::from_slice(&response[split+4..]).ok()?;let vectors:Vec<Vec<f64>>=serde_json::from_value(value["vectors"].clone()).ok()?;
  if vectors.len()!=texts.len()||vectors.iter().any(|v|v.len()!=384||v.iter().any(|f|!f.is_finite())){return None;}
  Some(vectors)
 }).await.ok().flatten()
}
pub(crate) async fn search(
    db: &PgPool,
    q: &str,
    global: bool,
    wid: Option<Uuid>,
) -> Option<Vec<Value>> {
    static LIMIT: std::sync::OnceLock<tokio::sync::Semaphore> = std::sync::OnceLock::new();
    let _permit = LIMIT
        .get_or_init(|| tokio::sync::Semaphore::new(2))
        .try_acquire()
        .ok()?;
    let query = embed(&[q.chars().take(8000).collect()]).await?.pop()?;
    // Authorization is applied before any text is sent to the local model.
    let notes:Vec<Value>=sqlx::query_scalar("SELECT json_build_object('id',k.id,'title',k.title,'content',k.content,'source',k.source,'workspace_id',w.id,'workspace_name',w.name,'verified',true) FROM knowledge k JOIN workspaces w ON w.id=k.workspace_id WHERE k.verified AND k.deleted_at IS NULL AND w.deleted_at IS NULL AND ($1 OR k.workspace_id=$2) ORDER BY k.created_at DESC LIMIT 300").bind(global).bind(wid).fetch_all(db).await.ok()?;
    let mut hits = Vec::new();
    let mut pending = Vec::new();
    for note in notes {
        let id = Uuid::parse_str(note["id"].as_str()?).ok()?;
        let text = format!("{}\n{}", note["title"].as_str()?, note["content"].as_str()?);
        let hash = digest(&text);
        let cached:Option<Vec<f64>>=sqlx::query_scalar("SELECT vector FROM knowledge_embeddings WHERE note_id=$1 AND content_hash=$2 AND model=$3").bind(id).bind(&hash).bind(MODEL).fetch_optional(db).await.ok()?;
        if let Some(vector) = cached {
            hits.push((note, vector));
        } else {
            pending.push((id, hash, text, note));
        }
    }
    for batch in pending.chunks(32) {
        let texts: Vec<String> = batch
            .iter()
            .map(|(_, _, s, _)| s.chars().take(8000).collect())
            .collect();
        let vectors = embed(&texts).await?;
        for ((id, hash, _, note), vector) in batch.iter().zip(vectors) {
            sqlx::query("INSERT INTO knowledge_embeddings(note_id,content_hash,model,vector) VALUES($1,$2,$3,$4) ON CONFLICT(note_id) DO UPDATE SET content_hash=EXCLUDED.content_hash,model=EXCLUDED.model,vector=EXCLUDED.vector,updated_at=now()").bind(id).bind(hash).bind(MODEL).bind(&vector).execute(db).await.ok()?;
            hits.push((note.clone(), vector));
        }
    }
    let mut ranked: Vec<(f64, Value)> = hits
        .into_iter()
        .map(|(mut note, vector)| {
            let score: f64 = query.iter().zip(vector).map(|(a, b)| a * b).sum();
            note["semantic_score"] = json!(score);
            (score, note)
        })
        .filter(|(s, _)| *s > 0.15)
        .collect();
    ranked.sort_by(|a, b| b.0.total_cmp(&a.0));
    Some(ranked.into_iter().take(20).map(|(_, note)| note).collect())
}
