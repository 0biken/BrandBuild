use axum::{extract::Request, middleware::Next, response::{IntoResponse, Response}};
use sqlx::{postgres::PgPoolOptions, PgPool, Postgres, Transaction};
use uuid::Uuid;

#[derive(Clone)]
pub struct Db { pub pool: PgPool }
pub async fn connect(database_url: &str) -> anyhow::Result<PgPool> {
    let pool=PgPoolOptions::new().max_connections(10).connect(database_url).await?;
    Ok(pool)
}
pub async fn migrate(pool:&PgPool)->anyhow::Result<()> { sqlx::migrate!("./migrations").run(pool).await?; Ok(()) }

impl Db {
    pub async fn connect(url: &str) -> anyhow::Result<Self> {
        let pool = PgPoolOptions::new().max_connections(20).connect(url).await?;
        Ok(Self { pool })
    }
    pub async fn migrate(&self) -> anyhow::Result<()> {
        sqlx::migrate!("./migrations").run(&self.pool).await?;
        Ok(())
    }
    pub async fn tenant_tx(&self, tenant_id: Uuid) -> anyhow::Result<Transaction<'_, Postgres>> {
        let mut tx = self.pool.begin().await?;
        sqlx::query("SELECT set_config('app.tenant_id', $1, true)")
            .bind(tenant_id.to_string()).execute(&mut *tx).await?;
        Ok(tx)
    }
}

pub async fn tenant_rls_middleware(mut request: Request, next: Next) -> Response {
    // Auth middleware must insert a verified TenantContext before tenant routes execute.
    let Some(ctx) = request.extensions().get::<crate::auth::TenantContext>().cloned() else {
        return axum::http::StatusCode::UNAUTHORIZED.into_response();
    };
    // The request handler uses tenant-scoped transactions via Db::tenant_tx; this
    // middleware makes resolved identity available without trusting request payloads.
    request.extensions_mut().insert(ctx);
    next.run(request).await
}
