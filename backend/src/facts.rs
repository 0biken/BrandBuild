//! Brand facts: offers, prices, opening hours and claims the workspace stands behind.
//!
//! Anyone in the workspace can write a fact; an owner or reviewer verifies it. Only
//! verified facts that haven't expired reach the AI planner, and a draft may only state a
//! price, offer or claim that cites one. Changing a verified fact makes it unverified again.
use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{get, patch, post},
    Json, Router,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{Postgres, Row, Transaction};
use uuid::Uuid;

use crate::{
    api::ApiError,
    audit,
    auth::{TenantContext, DECIDERS},
    db::tenant_tx,
    AppState,
};

type Tx = Transaction<'static, Postgres>;

const KINDS: [&str; 5] = ["offer", "price", "hours", "claim", "other"];
const COLUMNS: &str = "id,kind,label,value,price::text AS price,currency,starts_at,ends_at,source,status,verified_at,expires_at,updated_at";

/// A fact as the planner and the API see it.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Fact {
    pub id: Uuid,
    pub kind: String,
    pub label: String,
    pub value: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub price: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub currency: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub starts_at: Option<DateTime<Utc>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ends_at: Option<DateTime<Utc>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    /// `unverified`, `verified` or `expired` (past its end or expiry date).
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub verified_at: Option<DateTime<Utc>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<DateTime<Utc>>,
    pub updated_at: DateTime<Utc>,
}

fn fact_from(row: &sqlx::postgres::PgRow, now: DateTime<Utc>) -> Result<Fact, sqlx::Error> {
    let ends_at: Option<DateTime<Utc>> = row.try_get("ends_at")?;
    let expires_at: Option<DateTime<Utc>> = row.try_get("expires_at")?;
    let stored: String = row.try_get("status")?;
    let past = |at: Option<DateTime<Utc>>| at.is_some_and(|at| at <= now);
    let status = if past(ends_at) || past(expires_at) {
        "expired".to_owned()
    } else {
        stored
    };
    Ok(Fact {
        id: row.try_get("id")?,
        kind: row.try_get("kind")?,
        label: row.try_get("label")?,
        value: row.try_get("value")?,
        price: row.try_get("price")?,
        currency: row.try_get("currency")?,
        starts_at: row.try_get("starts_at")?,
        ends_at,
        source: row.try_get("source")?,
        status,
        verified_at: row.try_get("verified_at")?,
        expires_at,
        updated_at: row.try_get("updated_at")?,
    })
}

async fn all(tx: &mut Tx) -> Result<Vec<Fact>, ApiError> {
    let now = Utc::now();
    let rows = sqlx::query(&format!(
        "SELECT {COLUMNS} FROM brand_facts WHERE deleted_at IS NULL ORDER BY created_at DESC, id"
    ))
    .fetch_all(&mut **tx)
    .await?;
    Ok(rows
        .iter()
        .map(|row| fact_from(row, now))
        .collect::<Result<Vec<_>, _>>()?)
}

/// The facts the AI may use: verified, started and not expired.
pub async fn usable(tx: &mut Tx) -> Result<Vec<Fact>, ApiError> {
    let now = Utc::now();
    Ok(all(tx)
        .await?
        .into_iter()
        .filter(|f| f.status == "verified" && f.starts_at.is_none_or(|at| at <= now))
        .collect())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FactInput {
    kind: Option<String>,
    label: Option<String>,
    value: Option<String>,
    /// A number or a string such as "4500" or "4500.00". `null` clears it.
    #[serde(default, deserialize_with = "some")]
    price: Option<Value>,
    #[serde(default, deserialize_with = "some")]
    currency: Option<Option<String>>,
    #[serde(default, deserialize_with = "some")]
    starts_at: Option<Option<DateTime<Utc>>>,
    #[serde(default, deserialize_with = "some")]
    ends_at: Option<Option<DateTime<Utc>>>,
    #[serde(default, deserialize_with = "some")]
    source: Option<Option<String>>,
    #[serde(default, deserialize_with = "some")]
    expires_at: Option<Option<DateTime<Utc>>>,
}

/// Tells "field left out" (None) from "field set to null" (Some(None)).
fn some<'de, T, D>(d: D) -> Result<Option<T>, D::Error>
where
    T: Deserialize<'de>,
    D: serde::Deserializer<'de>,
{
    T::deserialize(d).map(Some)
}

/// A price as plain digits with up to two decimals, or None.
pub fn parse_price(value: &Value) -> Result<Option<String>, ApiError> {
    let text = match value {
        Value::Null => return Ok(None),
        Value::Number(n) => n.to_string(),
        Value::String(s) => s.trim().replace(',', ""),
        _ => return Err(ApiError::InvalidInput),
    };
    let (whole, cents) = text.split_once('.').unwrap_or((&text, ""));
    let digits = |s: &str| s.bytes().all(|b| b.is_ascii_digit());
    if whole.is_empty() || whole.len() > 10 || cents.len() > 2 || !digits(whole) || !digits(cents) {
        return Err(ApiError::InvalidInput);
    }
    Ok(Some(text))
}

fn clean(text: &str, max: usize) -> Result<String, ApiError> {
    let text = text.trim();
    if text.is_empty() || text.chars().count() > max {
        return Err(ApiError::InvalidInput);
    }
    Ok(text.to_owned())
}

fn check_currency(currency: &Option<String>) -> Result<(), ApiError> {
    match currency {
        Some(c) if c.len() != 3 || !c.bytes().all(|b| b.is_ascii_uppercase()) => {
            Err(ApiError::InvalidInput)
        }
        _ => Ok(()),
    }
}

async fn list_facts(
    State(s): State<AppState>,
    ctx: TenantContext,
) -> Result<Json<Value>, ApiError> {
    let mut tx = tenant_tx(&s.pool, ctx.tenant_id).await?;
    let data = all(&mut tx).await?;
    tx.commit().await?;
    Ok(Json(json!({ "data": data })))
}

async fn one(tx: &mut Tx, id: Uuid) -> Result<Fact, ApiError> {
    let row = sqlx::query(&format!(
        "SELECT {COLUMNS} FROM brand_facts WHERE id=$1 AND deleted_at IS NULL FOR UPDATE"
    ))
    .bind(id)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or(ApiError::NotFound)?;
    Ok(fact_from(&row, Utc::now())?)
}

async fn create_fact(
    State(s): State<AppState>,
    ctx: TenantContext,
    Json(input): Json<FactInput>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let kind = input.kind.ok_or(ApiError::InvalidInput)?;
    if !KINDS.contains(&kind.as_str()) {
        return Err(ApiError::InvalidInput);
    }
    let label = clean(&input.label.ok_or(ApiError::InvalidInput)?, 200)?;
    let value = clean(&input.value.ok_or(ApiError::InvalidInput)?, 1000)?;
    let price = parse_price(&input.price.unwrap_or(Value::Null))?;
    let currency = input.currency.flatten();
    check_currency(&currency)?;
    let mut tx = tenant_tx(&s.pool, ctx.tenant_id).await?;
    let id: Uuid = sqlx::query_scalar(
        "INSERT INTO brand_facts(tenant_id,kind,label,value,price,currency,starts_at,ends_at,source,owner_id,expires_at)
         VALUES($1,$2,$3,$4,$5::numeric,$6,$7,$8,$9,$10,$11) RETURNING id",
    )
    .bind(ctx.tenant_id)
    .bind(&kind)
    .bind(&label)
    .bind(&value)
    .bind(&price)
    .bind(&currency)
    .bind(input.starts_at.flatten())
    .bind(input.ends_at.flatten())
    .bind(input.source.flatten().map(|s| s.trim().chars().take(500).collect::<String>()))
    .bind(ctx.actor_id)
    .bind(input.expires_at.flatten())
    .fetch_one(&mut *tx)
    .await?;
    audit::record(
        &mut tx,
        &ctx,
        "fact_created",
        "brand_fact",
        id,
        json!({ "kind": kind }),
    )
    .await?;
    let out = one(&mut tx, id).await?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(json!({ "data": out }))))
}

fn parse_id(id: &str) -> Result<Uuid, ApiError> {
    Uuid::parse_str(id).map_err(|_| ApiError::NotFound)
}

/// Saves changes. Whatever was verified before, the changed fact needs verifying again.
async fn update_fact(
    State(s): State<AppState>,
    ctx: TenantContext,
    Path(id): Path<String>,
    Json(input): Json<FactInput>,
) -> Result<Json<Value>, ApiError> {
    let id = parse_id(&id)?;
    let mut tx = tenant_tx(&s.pool, ctx.tenant_id).await?;
    let old = one(&mut tx, id).await?;
    let kind = input.kind.unwrap_or_else(|| old.kind.clone());
    if !KINDS.contains(&kind.as_str()) {
        return Err(ApiError::InvalidInput);
    }
    let label = clean(input.label.as_deref().unwrap_or(&old.label), 200)?;
    let value = clean(input.value.as_deref().unwrap_or(&old.value), 1000)?;
    let price = match &input.price {
        Some(price) => parse_price(price)?,
        None => old.price.clone(),
    };
    let currency = input.currency.unwrap_or_else(|| old.currency.clone());
    check_currency(&currency)?;
    sqlx::query(
        "UPDATE brand_facts SET kind=$2,label=$3,value=$4,price=$5::numeric,currency=$6,starts_at=$7,ends_at=$8,
           source=$9,expires_at=$10,status='unverified',verified_by=NULL,verified_at=NULL,updated_at=now()
         WHERE id=$1",
    )
    .bind(id)
    .bind(&kind)
    .bind(&label)
    .bind(&value)
    .bind(&price)
    .bind(&currency)
    .bind(input.starts_at.unwrap_or(old.starts_at))
    .bind(input.ends_at.unwrap_or(old.ends_at))
    .bind(input.source.unwrap_or_else(|| old.source.clone()))
    .bind(input.expires_at.unwrap_or(old.expires_at))
    .execute(&mut *tx)
    .await?;
    audit::record(
        &mut tx,
        &ctx,
        "fact_updated",
        "brand_fact",
        id,
        json!({ "was": old.status }),
    )
    .await?;
    let out = one(&mut tx, id).await?;
    tx.commit().await?;
    Ok(Json(json!({ "data": out })))
}

async fn delete_fact(
    State(s): State<AppState>,
    ctx: TenantContext,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
    let id = parse_id(&id)?;
    let mut tx = tenant_tx(&s.pool, ctx.tenant_id).await?;
    one(&mut tx, id).await?;
    sqlx::query("UPDATE brand_facts SET deleted_at=now() WHERE id=$1")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    audit::record(&mut tx, &ctx, "fact_deleted", "brand_fact", id, json!({})).await?;
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

/// An owner or reviewer confirms the fact is true as written.
async fn verify_fact(
    State(s): State<AppState>,
    ctx: TenantContext,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    ctx.require(DECIDERS)?;
    let id = parse_id(&id)?;
    let mut tx = tenant_tx(&s.pool, ctx.tenant_id).await?;
    let fact = one(&mut tx, id).await?;
    if fact.status == "expired" {
        return Err(ApiError::Conflict);
    }
    sqlx::query(
        "UPDATE brand_facts SET status='verified',verified_by=$2,verified_at=now(),updated_at=now() WHERE id=$1",
    )
    .bind(id)
    .bind(ctx.actor_id)
    .execute(&mut *tx)
    .await?;
    audit::record(
        &mut tx,
        &ctx,
        "fact_verified",
        "brand_fact",
        id,
        json!({ "value": fact.value }),
    )
    .await?;
    let out = one(&mut tx, id).await?;
    tx.commit().await?;
    Ok(Json(json!({ "data": out })))
}

/// Mounted inside the authenticated `/v1` router.
pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/brand/facts", get(list_facts).post(create_fact))
        .route(
            "/brand/facts/:fact_id",
            patch(update_fact).delete(delete_fact),
        )
        .route("/brand/facts/:fact_id/verify", post(verify_fact))
}

#[cfg(test)]
mod tests {
    use super::parse_price;
    use serde_json::json;

    #[test]
    fn prices_are_plain_amounts() {
        assert_eq!(parse_price(&json!(4500)).unwrap(), Some("4500".into()));
        assert_eq!(
            parse_price(&json!("4,500.50")).unwrap(),
            Some("4500.50".into())
        );
        assert_eq!(parse_price(&json!(null)).unwrap(), None);
        for bad in [
            json!("-5"),
            json!("1.999"),
            json!("abc"),
            json!(""),
            json!(1e30),
            json!([1]),
        ] {
            assert!(parse_price(&bad).is_err(), "{bad}");
        }
    }
}
