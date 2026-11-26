pub mod admin;
pub mod ai;
pub mod api;
pub mod approvals;
pub mod audit;
pub mod auth;
pub mod auth_api;
pub mod brand;
pub mod content;
pub mod db;
pub mod domain;
pub mod facts;
pub mod media;
pub mod notifications;
pub mod onboarding;
pub mod outbox;
pub mod publishing;
pub mod storage;
pub mod workers;

#[derive(Clone)]
pub struct AppState {
    pub pool: sqlx::PgPool,
    pub admin_pool: sqlx::PgPool,
    pub storage: storage::Storage,
    pub ai: std::sync::Arc<ai::Gateway>,
}
