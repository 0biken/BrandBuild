use sqlx::{postgres::PgPoolOptions, PgPool, Postgres, Transaction};
use uuid::Uuid;

pub async fn connect(database_url: &str) -> anyhow::Result<PgPool> {
    let pool = PgPoolOptions::new()
        .max_connections(10)
        .connect(database_url)
        .await?;
    Ok(pool)
}
/// Opens a transaction scoped to one workspace. Row-level security (migration 0005)
/// hides every other workspace's rows from it.
pub async fn tenant_tx(
    pool: &PgPool,
    tenant_id: Uuid,
) -> Result<Transaction<'static, Postgres>, sqlx::Error> {
    let mut tx = pool.begin().await?;
    sqlx::query("SELECT set_config('app.tenant_id', $1, true)")
        .bind(tenant_id.to_string())
        .execute(&mut *tx)
        .await?;
    Ok(tx)
}
pub async fn migrate(pool: &PgPool) -> anyhow::Result<()> {
    sqlx::migrate!("./migrations").run(pool).await?;
    Ok(())
}
