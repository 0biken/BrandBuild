//! The workspace's brand kit (docs/api/openapi.yaml, tag `brand`). One brand per workspace:
//! the oldest `brand_profiles` row, created on first read. Its details are kept in `voice`.
use axum::{extract::State, routing::get, Json, Router};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{Postgres, Row, Transaction};
use uuid::Uuid;

use crate::{api::ApiError, audit, auth::TenantContext, db::tenant_tx, AppState};

type Tx = Transaction<'static, Postgres>;

const TONES: [&str; 4] = ["Warm", "Playful", "Professional", "Bold"];
/// Room for a small logo as a data URL; larger images belong in the media library.
const LOGO_MAX_CHARS: usize = 400_000;

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct BrandProfile {
    name: String,
    #[serde(default)]
    sells: String,
    #[serde(default)]
    audience: Vec<String>,
    #[serde(default)]
    tones: Vec<String>,
    #[serde(default)]
    words_use: Vec<String>,
    #[serde(default)]
    words_avoid: Vec<String>,
    #[serde(default = "default_color")]
    color: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    palette: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    logo: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    fonts: Option<Fonts>,
    #[serde(default)]
    samples: String,
}

#[derive(Deserialize, Serialize)]
struct Fonts {
    heading: String,
    body: String,
}

fn default_color() -> String {
    "#0F2A1B".into()
}

fn is_hex(color: &str) -> bool {
    color.len() == 7 && color.starts_with('#') && color[1..].bytes().all(|b| b.is_ascii_hexdigit())
}

fn check(profile: &BrandProfile) -> Result<(), ApiError> {
    let ok = !profile.name.trim().is_empty()
        && (1..=2).contains(&profile.tones.len())
        && profile.tones.iter().all(|t| TONES.contains(&t.as_str()))
        && is_hex(&profile.color)
        && profile
            .palette
            .as_ref()
            .is_none_or(|p| p.len() <= 3 && p.iter().all(|c| is_hex(c)))
        && profile
            .logo
            .as_ref()
            .is_none_or(|l| l.len() <= LOGO_MAX_CHARS);
    if ok {
        Ok(())
    } else {
        Err(ApiError::InvalidInput)
    }
}

/// The workspace's brand row id, creating an empty one the first time.
async fn ensure(tx: &mut Tx, ctx: &TenantContext) -> Result<Uuid, ApiError> {
    let existing: Option<Uuid> =
        sqlx::query_scalar("SELECT id FROM brand_profiles ORDER BY created_at, id LIMIT 1")
            .fetch_optional(&mut **tx)
            .await?;
    if let Some(id) = existing {
        return Ok(id);
    }
    Ok(
        sqlx::query_scalar("INSERT INTO brand_profiles(tenant_id,name) VALUES($1,'') RETURNING id")
            .bind(ctx.tenant_id)
            .fetch_one(&mut **tx)
            .await?,
    )
}

async fn brand_json(tx: &mut Tx, ctx: &TenantContext, id: Uuid) -> Result<Value, ApiError> {
    let row = sqlx::query(
        "SELECT b.name,b.voice,t.plan,t.plan_ends_at FROM brand_profiles b JOIN tenants t ON t.id=b.tenant_id WHERE b.id=$1 AND t.id=$2",
    )
    .bind(id)
    .bind(ctx.tenant_id)
    .fetch_one(&mut **tx)
    .await?;
    let mut stored: Value = row.try_get("voice")?;
    stored["name"] = json!(row.try_get::<String, _>("name")?);
    // Reading through the struct fills in defaults for anything not saved yet.
    let profile: BrandProfile = serde_json::from_value(stored).map_err(|_| ApiError::Internal)?;
    let voice = profile.tones.join(", ").to_lowercase();
    let mut out = serde_json::to_value(&profile).map_err(|_| ApiError::Internal)?;
    out["id"] = json!(id);
    out["voice"] = json!(voice);
    out["plan"] = json!(row.try_get::<String, _>("plan")?);
    if let Some(ends) = row.try_get::<Option<DateTime<Utc>>, _>("plan_ends_at")? {
        out["planEndsAt"] = json!(ends.to_rfc3339());
    }
    Ok(out)
}

async fn get_brand(State(s): State<AppState>, ctx: TenantContext) -> Result<Json<Value>, ApiError> {
    let mut tx = tenant_tx(&s.pool, ctx.tenant_id).await?;
    let id = ensure(&mut tx, &ctx).await?;
    let out = brand_json(&mut tx, &ctx, id).await?;
    tx.commit().await?;
    Ok(Json(json!({ "data": out })))
}

async fn update_brand(
    State(s): State<AppState>,
    ctx: TenantContext,
    Json(profile): Json<BrandProfile>,
) -> Result<Json<Value>, ApiError> {
    check(&profile)?;
    let mut tx = tenant_tx(&s.pool, ctx.tenant_id).await?;
    let id = ensure(&mut tx, &ctx).await?;
    let mut stored = serde_json::to_value(&profile).map_err(|_| ApiError::Internal)?;
    if let Some(map) = stored.as_object_mut() {
        map.remove("name");
    }
    sqlx::query("UPDATE brand_profiles SET name=$2,voice=$3,updated_at=now() WHERE id=$1")
        .bind(id)
        .bind(profile.name.trim())
        .bind(stored)
        .execute(&mut *tx)
        .await?;
    audit::record(&mut tx, &ctx, "brand_updated", "brand", id, json!({})).await?;
    let out = brand_json(&mut tx, &ctx, id).await?;
    tx.commit().await?;
    Ok(Json(json!({ "data": out })))
}

/// Mounted inside the authenticated `/v1` router.
pub fn routes() -> Router<AppState> {
    Router::new().route("/brand", get(get_brand).put(update_brand))
}
