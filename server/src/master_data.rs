use super::*;
use std::collections::HashSet;
const MANIFEST: &str = include_str!("../master-data/manifest.json");
const SOURCES: [(&str, &str); 4] = [
    ("zodiac", include_str!("../master-data/zodiac-signs.json")),
    (
        "trait",
        include_str!("../master-data/personality-traits.json"),
    ),
    (
        "rule",
        include_str!("../master-data/zodiac-personality-rules.json"),
    ),
    (
        "criterion",
        include_str!("../master-data/recruitment-criteria.json"),
    ),
];
pub(crate) struct MasterBundle {
    pub version: i32,
    pub rows: Vec<(String, String, Value)>,
    pub checksum: String,
}
impl MasterBundle {
    pub fn bundled() -> std::result::Result<Self, String> {
        let manifest: Value = serde_json::from_str(MANIFEST).map_err(|e| e.to_string())?;
        let version = manifest["version"]
            .as_i64()
            .filter(|v| *v > 0)
            .ok_or("Invalid master version")? as i32;
        let mut rows = vec![];
        let mut content = MANIFEST.to_owned();
        for (category, source) in SOURCES {
            content.push_str(source);
            let list: Vec<Value> = serde_json::from_str(source).map_err(|e| e.to_string())?;
            for value in list {
                let id = value["id"]
                    .as_str()
                    .filter(|id| {
                        !id.is_empty()
                            && id.len() <= 80
                            && id.bytes().all(|b| b.is_ascii_lowercase() || b == b'_')
                    })
                    .ok_or("Invalid master ID")?
                    .to_owned();
                rows.push((category.into(), id, value));
            }
        }
        let bundle = Self {
            version,
            rows,
            checksum: digest(&content),
        };
        bundle.validate()?;
        Ok(bundle)
    }
    fn validate(&self) -> std::result::Result<(), String> {
        let mut ids = HashSet::new();
        for (c, id, _) in &self.rows {
            if !ids.insert((c.clone(), id.clone())) {
                return Err("Duplicate master ID".into());
            }
        }
        let traits: HashSet<_> = self
            .rows
            .iter()
            .filter(|r| r.0 == "trait")
            .map(|r| r.1.as_str())
            .collect();
        let signs: HashSet<_> = self
            .rows
            .iter()
            .filter(|r| r.0 == "zodiac")
            .map(|r| r.1.as_str())
            .collect();
        if signs.len() != 12 || traits.len() < 3 {
            return Err("Incomplete zodiac/trait library".into());
        }
        for (_, _, row) in self.rows.iter().filter(|r| r.0 == "rule") {
            if !signs.contains(row["zodiac_id"].as_str().unwrap_or("")) {
                return Err("Unknown zodiac reference".into());
            }
            let core = row["core_traits"].as_array().ok_or("Missing core traits")?;
            let pool = row["pool"].as_array().ok_or("Missing weighted pool")?;
            if core.len() != 2 || core[0] == core[1] || pool.is_empty() {
                return Err("Invalid personality rule".into());
            }
            for id in core {
                if !traits.contains(id.as_str().unwrap_or("")) {
                    return Err("Unknown trait".into());
                }
            }
            if !pool.iter().any(|item| !core.contains(&item["trait_id"])) {
                return Err("Pool must include another trait".into());
            }
            for item in pool {
                if !traits.contains(item["trait_id"].as_str().unwrap_or(""))
                    || item["weight"]
                        .as_u64()
                        .filter(|w| *w > 0 && *w <= 100)
                        .is_none()
                {
                    return Err("Invalid weighted trait".into());
                }
            }
        }
        if self.rows.iter().filter(|r| r.0 == "rule").count() != 12 {
            return Err("Missing zodiac rules".into());
        }
        for month in 1..=12 {
            for day in 1..=month_days(2000, month) {
                let count = self
                    .rows
                    .iter()
                    .filter(|r| r.0 == "zodiac" && matches_sign(&r.2, month, day))
                    .count();
                if count != 1 {
                    return Err("Zodiac dates overlap or leave gaps".into());
                }
            }
        }
        let criteria: Vec<_> = self.rows.iter().filter(|r| r.0 == "criterion").collect();
        if criteria.len() < 2
            || criteria
                .iter()
                .map(|r| r.2["weight"].as_u64().unwrap_or(0))
                .sum::<u64>()
                != 100
        {
            return Err("Criteria weights must total 100".into());
        }
        Ok(())
    }
}
pub(crate) async fn import(
    db: &PgPool,
) -> std::result::Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let bundle = MasterBundle::bundled()?;
    let mut tx = db.begin().await?;
    sqlx::query("SELECT pg_advisory_xact_lock(448721903)")
        .execute(&mut *tx)
        .await?;
    let old: Option<String> =
        sqlx::query_scalar("SELECT checksum FROM master_data_imports WHERE version=$1")
            .bind(bundle.version)
            .fetch_optional(&mut *tx)
            .await?;
    if let Some(checksum) = old {
        if checksum != bundle.checksum {
            return Err("Master data bundle changed without a version bump".into());
        }
        return Ok(());
    }
    for (category, id, payload) in bundle.rows {
        sqlx::query(
            "INSERT INTO master_data VALUES($1,$2,$3,$4) ON CONFLICT(category,id) DO NOTHING",
        )
        .bind(category)
        .bind(id)
        .bind(payload)
        .bind(bundle.version)
        .execute(&mut *tx)
        .await?;
    }
    sqlx::query("INSERT INTO master_data_imports(version,checksum) VALUES($1,$2)")
        .bind(bundle.version)
        .bind(bundle.checksum)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(())
}
fn month_days(year: u32, month: u32) -> u32 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => {
            if year % 400 == 0 || (year % 4 == 0 && year % 100 != 0) {
                29
            } else {
                28
            }
        }
        _ => 0,
    }
}
pub(crate) fn date(value: &str) -> Option<(u32, u32, u32)> {
    if value.len() != 10
        || value.as_bytes()[4] != b'-'
        || value.as_bytes()[7] != b'-'
        || !value
            .bytes()
            .enumerate()
            .all(|(i, b)| i == 4 || i == 7 || b.is_ascii_digit())
    {
        return None;
    }
    let year = value[..4].parse().ok()?;
    let month = value[5..7].parse().ok()?;
    let day = value[8..].parse().ok()?;
    if year == 0 || day == 0 || day > month_days(year, month) {
        None
    } else {
        Some((year, month, day))
    }
}
fn matches_sign(sign: &Value, m: u32, d: u32) -> bool {
    let start =
        sign["start"][0].as_u64().unwrap_or(99) * 100 + sign["start"][1].as_u64().unwrap_or(99);
    let end = sign["end"][0].as_u64().unwrap_or(99) * 100 + sign["end"][1].as_u64().unwrap_or(99);
    let point = (m * 100 + d) as u64;
    if start <= end {
        point >= start && point <= end
    } else {
        point >= start || point <= end
    }
}
pub(crate) async fn generate(db: &PgPool, id: Uuid, birth: &str) -> Result<Option<Value>> {
    if birth.is_empty() {
        return Ok(None);
    }
    let (_, month, day) = date(birth).ok_or(bad("Birth date must be a valid YYYY-MM-DD date"))?;
    let bundle: Vec<(String, String, Value)> =
        sqlx::query_as("SELECT category,id,payload FROM master_data ORDER BY category,id")
            .fetch_all(db)
            .await?;
    let sign = bundle
        .iter()
        .find(|r| r.0 == "zodiac" && matches_sign(&r.2, month, day))
        .ok_or(bad("Zodiac master data unavailable"))?;
    let rule = bundle
        .iter()
        .find(|r| r.0 == "rule" && r.1 == sign.1)
        .ok_or(bad("Personality rule unavailable"))?;
    let mut selected: Vec<String> = rule.2["core_traits"]
        .as_array()
        .ok_or(bad("Invalid core traits"))?
        .iter()
        .filter_map(|v| v.as_str().map(String::from))
        .collect();
    if selected.len() != 2 {
        return Err(bad("Invalid core traits"));
    }
    let pool: Vec<(String, u64)> = rule.2["pool"]
        .as_array()
        .ok_or(bad("Invalid personality pool"))?
        .iter()
        .filter_map(|v| Some((v["trait_id"].as_str()?.to_owned(), v["weight"].as_u64()?)))
        .filter(|(id, w)| !selected.contains(id) && *w > 0 && *w <= 100)
        .collect();
    let total: u64 = pool.iter().map(|p| p.1).sum();
    if total == 0 {
        return Err(bad("Empty personality pool"));
    }
    let hash = Sha256::digest(format!("personality-v1:{id}:{birth}:{}", sign.1).as_bytes());
    let mut choice = u64::from_le_bytes(hash[..8].try_into().unwrap()) % total;
    for (trait_id, weight) in pool {
        if choice < weight {
            selected.push(trait_id);
            break;
        }
        choice -= weight;
    }
    let mut traits = vec![];
    for id in selected {
        traits.push(
            bundle
                .iter()
                .find(|r| r.0 == "trait" && r.1 == id)
                .ok_or(bad("Personality trait missing"))?
                .2
                .clone(),
        );
    }
    let version: i32 = sqlx::query_scalar("SELECT max(version) FROM master_data_imports")
        .fetch_one(db)
        .await?;
    Ok(Some(
        json!({"engine_version":1,"master_version":version,"basis":"fictional_zodiac_theme","birth_date":birth,"zodiac_id":sign.1,"zodiac_name":sign.2["name"],"traits":traits}),
    ))
}
pub(crate) fn routes() -> Router<App> {
    Router::new().route("/master-data", get(library))
}
async fn library(State(a): State<App>, h: HeaderMap) -> Result<Json<Value>> {
    user(&a, &h).await?;
    let rows: Vec<(String, Value)> =
        sqlx::query_as("SELECT category,payload FROM master_data ORDER BY category,id")
            .fetch_all(&a.db)
            .await?;
    let versions: Vec<Value> = sqlx::query_scalar(
        "SELECT to_jsonb(i)-'checksum' FROM master_data_imports i ORDER BY version",
    )
    .fetch_all(&a.db)
    .await?;
    let mut out = json!({"versions":versions,"basis":"fictional_zodiac_theme","zodiac":[],"trait":[],"rule":[],"criterion":[]});
    for (category, payload) in rows {
        if let Some(list) = out[&category].as_array_mut() {
            list.push(payload);
        }
    }
    Ok(Json(out))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bundle_is_complete_and_invalid_references_are_rejected() {
        let mut b = MasterBundle::bundled().unwrap();
        b.rows.push(b.rows[0].clone());
        assert!(b.validate().is_err());
        let mut b = MasterBundle::bundled().unwrap();
        b.rows.iter_mut().find(|r| r.0 == "rule").unwrap().2["core_traits"] =
            json!(["missing", "curious"]);
        assert!(b.validate().is_err());
    }
    #[test]
    fn gregorian_dates_include_leap_year_boundaries() {
        assert!(date("2000-02-29").is_some());
        for value in [
            "1900-02-29",
            "2023-02-29",
            "2026-04-31",
            "2026-13-01",
            "0000-01-01",
            "2026-1-01",
            "💥2026-01",
        ] {
            assert!(date(value).is_none(), "{value}");
        }
    }
}
