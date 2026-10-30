mod admin;
mod application;
mod auth;
mod collaboration;
mod domain;
mod infrastructure;
mod master_data;
mod organization;
mod personal_workers;
mod quota;
mod recruitment;
mod workspaces;
use admin::*;
use auth::*;
use workspaces::*;
mod phase2;
mod provider_login;
mod worker;
mod usage;
use argon2::{
    password_hash::{rand_core::OsRng, SaltString},
    Argon2, PasswordHash, PasswordHasher, PasswordVerifier,
};
use axum::{
    extract::Request,
    extract::{DefaultBodyLimit, Path, State},
    http::{header, HeaderMap, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::{FromRow, PgPool};
use tower_http::services::{ServeDir, ServeFile};
use uuid::Uuid;

#[derive(Clone)]
struct App {
    db: PgPool,
    redis: redis::Client,
}
#[derive(Debug)]
struct Error(StatusCode, &'static str);
type Result<T> = std::result::Result<T, Error>;
impl IntoResponse for Error {
    fn into_response(self) -> Response {
        (self.0, Json(json!({"error":self.1}))).into_response()
    }
}
impl From<sqlx::Error> for Error {
    fn from(e: sqlx::Error) -> Self {
        eprintln!("database operation failed: {e}");
        Self(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Database operation failed",
        )
    }
}
fn bad(msg: &'static str) -> Error {
    Error(StatusCode::BAD_REQUEST, msg)
}
fn digest(s: &str) -> String {
    format!("{:x}", Sha256::digest(s.as_bytes()))
}
fn valid(s: &str, max: usize) -> bool {
    !s.trim().is_empty() && s.len() <= max
}
#[derive(Serialize, FromRow, Clone)]
struct User {
    id: Uuid,
    email: String,
    name: String,
    is_super_admin: bool,
}
pub async fn run() {
    if std::env::args().any(|a| a == "--worker") {
        tokio::select! {
            r=worker::run_worker()=>{if let Err(e)=r {eprintln!("Worker stopped: {e}");std::process::exit(1);}},
            _=shutdown()=>{}
        }
        return;
    }
    let db = PgPool::connect(&std::env::var("DATABASE_URL").expect("DATABASE_URL required"))
        .await
        .expect("Postgres connection failed");
    sqlx::migrate!("./migrations")
        .run(&db)
        .await
        .expect("Migration failed");
    master_data::import(&db)
        .await
        .expect("Master data import failed");
    let email = std::env::var("OWNER_EMAIL")
        .expect("OWNER_EMAIL required")
        .trim()
        .to_lowercase();
    let exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM users WHERE is_super_admin)")
            .fetch_one(&db)
            .await
            .unwrap();
    if !exists {
        let password =
            std::env::var("OWNER_PASSWORD").expect("OWNER_PASSWORD required for first boot");
        assert!(
            password.len() >= 12,
            "OWNER_PASSWORD must have at least 12 bytes"
        );
        let hash = Argon2::default()
            .hash_password(password.as_bytes(), &SaltString::generate(&mut OsRng))
            .unwrap()
            .to_string();
        let uid = Uuid::new_v4();
        let mut tx = db.begin().await.unwrap();
        sqlx::query("INSERT INTO users(id,email,name,password_hash,is_super_admin) VALUES($1,$2,'Owner',$3,true)").bind(uid).bind(email).bind(hash).execute(&mut *tx).await.unwrap();
        tx.commit().await.unwrap();
    }
    let app = App {
        db,
        redis: redis::Client::open(std::env::var("REDIS_URL").expect("REDIS_URL required"))
            .unwrap(),
    };
    personal_workers::reconcile(app.clone());
    quota::scheduler(app.db.clone());
    let api = Router::new()
        .route("/health", get(health))
        .route("/auth/login", post(login))
        .route("/auth/logout", post(logout))
        .route("/auth/me", get(me))
        .route("/workspaces", get(workspaces).post(create_workspace))
        .route("/workspaces/{wid}", get(snapshot))
        .route("/workspaces/{wid}/knowledge", post(knowledge))
        .route("/workspaces/{wid}/layout", axum::routing::put(layout))
        .route("/admin/users", post(create_user))
        .merge(
            phase2::routes()
                .merge(provider_login::routes())
                .merge(collaboration::routes())
                .merge(organization::routes())
                .merge(master_data::routes())
                .merge(recruitment::routes())
                .merge(quota::routes())
                .merge(personal_workers::routes()),
        )
        .fallback(|| async { Error(StatusCode::NOT_FOUND, "API route not found") })
        .with_state(app);
    let router = Router::new()
        .nest("/api", api)
        .fallback_service(
            ServeDir::new("/app/web").not_found_service(ServeFile::new("/app/web/index.html")),
        )
        .layer(DefaultBodyLimit::max(6 * 1024 * 1024))
        .layer(middleware::from_fn(protect));
    let listener = tokio::net::TcpListener::bind("0.0.0.0:8080").await.unwrap();
    println!("Agent Office listening on :8080; explicit worker start and subscription login required; no API-key fallback");
    axum::serve(listener, router)
        .with_graceful_shutdown(shutdown())
        .await
        .unwrap();
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn layout_rejects_overlap_and_out_of_bounds() {
        let i = Item {
            id: "a".into(),
            kind: "desk".into(),
            x: 1,
            y: 1,
            rotation: 0,
        };
        assert!(valid_layout(&Layout {
            items: vec![i.clone()]
        }));
        let mut j = i.clone();
        j.id = "b".into();
        assert!(!valid_layout(&Layout {
            items: vec![i.clone(), j]
        }));
        let mut j = i;
        j.x = 20;
        assert!(!valid_layout(&Layout { items: vec![j] }));
    }
}

async fn shutdown() {
    #[cfg(unix)]
    {
        let mut term = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("signal handler");
        tokio::select! {_=tokio::signal::ctrl_c()=>{},_=term.recv()=>{}}
    }
    #[cfg(not(unix))]
    {
        let _ = tokio::signal::ctrl_c().await;
    }
}
