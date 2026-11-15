use anyhow::Context;
use brandbuild_backend::{api, db, workers, AppState};
use std::net::SocketAddr;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();
    let database_url = std::env::var("DATABASE_URL").context("DATABASE_URL must be set")?;
    // Migrations run as the schema owner; the API itself connects as brandbuild_app,
    // which row-level security applies to. Without MIGRATION_DATABASE_URL both use DATABASE_URL.
    match std::env::var("MIGRATION_DATABASE_URL") {
        Ok(owner_url) => db::migrate(&db::connect(&owner_url).await?).await?,
        Err(_) => db::migrate(&db::connect(&database_url).await?).await?,
    }
    let pool = db::connect(&database_url).await?;
    let admin_pool = match std::env::var("ADMIN_DATABASE_URL") {
        Ok(admin_url) => db::connect(&admin_url).await?,
        Err(_) => pool.clone(),
    };
    let storage = brandbuild_backend::storage::Storage::from_env()?;
    let ai = std::sync::Arc::new(brandbuild_backend::ai::Gateway::from_env());
    let state = AppState {
        pool,
        admin_pool,
        storage,
        ai,
    };
    tokio::spawn(workers::run(state.clone()));
    let app = api::router(state);
    let port = std::env::var("PORT").unwrap_or_else(|_| "3000".to_owned());
    let addr: SocketAddr = format!("0.0.0.0:{port}").parse()?;
    let listener = tokio::net::TcpListener::bind(addr).await?;
    tracing::info!(%addr, "BrandBuild API listening");
    axum::serve(listener, app).await?;
    Ok(())
}
