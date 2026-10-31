use anyhow::Context;
use brandbuild_backend::{api, db, workers, AppState};
use std::net::SocketAddr;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")))
        .init();
    let database_url = std::env::var("DATABASE_URL").context("DATABASE_URL must be set")?;
    let pool = db::connect(&database_url).await?;
    let state = AppState { pool, v2: api::V2Store::default() };
    tokio::spawn(workers::run(state.clone()));
    let app = api::router(state);
    let addr: SocketAddr = "0.0.0.0:3000".parse()?;
    let listener = tokio::net::TcpListener::bind(addr).await?;
    tracing::info!(%addr, "BrandBuild API listening");
    axum::serve(listener, app).await?;
    Ok(())
}
