use super::*;
pub(crate) const TEXT: &str = include_str!("../../standards/application-runtime-v2.md");
pub(crate) fn bundled() -> Value {
    json!({"id":"application-runtime","version":2,"title":"มาตรฐานการสร้างและเปิดโปรแกรมด้วย Runner","instructions":TEXT,"checksum":digest(TEXT)})
}
pub(crate) async fn import(db: &PgPool) -> Result<()> {
    let b = bundled();
    sqlx::query("INSERT INTO system_standards(id,version,title,instructions,checksum) VALUES($1,2,$2,$3,$4) ON CONFLICT(id,version) DO UPDATE SET title=EXCLUDED.title,instructions=EXCLUDED.instructions,checksum=EXCLUDED.checksum").bind(b["id"].as_str()).bind(b["title"].as_str()).bind(TEXT).bind(b["checksum"].as_str()).execute(db).await?;
    Ok(())
}
pub(crate) fn prompt(context: Option<&Value>) -> String {
    if context
        .and_then(|c| c["standards"].as_array())
        .is_some_and(|a| {
            a.iter()
                .any(|s| s["id"] == "application-runtime" && s["version"] == 2)
        })
    {
        String::new()
    } else {
        format!("\nSystem-wide application delivery standard (v2; supersedes old task-root code paths):\n{TEXT}\n")
    }
}
