pub mod api;
pub mod auth;
pub mod db;
pub mod domain;
pub mod outbox;
pub mod workers;

#[derive(Clone)]
pub struct AppState {
    pub pool: sqlx::PgPool,
}
