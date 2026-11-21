//! What the model may see: a minimal, tenant-scoped, versioned snapshot. Brand profile,
//! verified facts, ready media (names and tags only) and what's already planned in the
//! window. No emails, member names or other personal data, and no past captions beyond
//! a short summary used to avoid repeats.
use chrono::{DateTime, Duration, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::{Postgres, Row, Transaction};
use uuid::Uuid;

use crate::{api::ApiError, facts};

type Tx = Transaction<'static, Postgres>;

pub const CONTEXT_VERSION: &str = "context.v1";

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct BrandCtx {
    pub name: String,
    pub sells: String,
    pub audience: Vec<String>,
    pub tones: Vec<String>,
    pub words_use: Vec<String>,
    pub words_avoid: Vec<String>,
    pub samples: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FactCtx {
    pub id: String,
    pub kind: String,
    pub label: String,
    pub value: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub price: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub currency: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ends_at: Option<DateTime<Utc>>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaCtx {
    pub id: String,
    pub name: String,
    pub kind: String,
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExistingCtx {
    pub date: NaiveDate,
    pub platforms: Vec<String>,
    pub summary: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub version: &'static str,
    pub timezone: String,
    pub start: NaiveDate,
    /// Last day of the window, inclusive.
    pub end: NaiveDate,
    pub platforms: Vec<String>,
    pub brand: BrandCtx,
    pub facts: Vec<FactCtx>,
    pub media: Vec<MediaCtx>,
    pub existing: Vec<ExistingCtx>,
}

fn strings(v: &Value) -> Vec<String> {
    v.as_array()
        .map(|a| {
            a.iter()
                .filter_map(|s| s.as_str().map(str::to_owned))
                .collect()
        })
        .unwrap_or_default()
}

fn short(text: &str, max: usize) -> String {
    let mut out: String = text.chars().take(max).collect();
    if text.chars().count() > max {
        out.push('…');
    }
    out
}

pub async fn build(
    tx: &mut Tx,
    tenant: Uuid,
    start: NaiveDate,
    days: i64,
    platforms: &[String],
) -> Result<Snapshot, ApiError> {
    let end = start + Duration::days(days - 1);
    let timezone: String = sqlx::query_scalar("SELECT timezone FROM tenants WHERE id=$1")
        .bind(tenant)
        .fetch_one(&mut **tx)
        .await?;

    let brand =
        match sqlx::query("SELECT name,voice FROM brand_profiles ORDER BY created_at, id LIMIT 1")
            .fetch_optional(&mut **tx)
            .await?
        {
            Some(row) => {
                let voice: Value = row.try_get("voice")?;
                BrandCtx {
                    name: row.try_get("name")?,
                    sells: short(voice["sells"].as_str().unwrap_or(""), 500),
                    audience: strings(&voice["audience"]),
                    tones: strings(&voice["tones"]),
                    words_use: strings(&voice["wordsUse"]),
                    words_avoid: strings(&voice["wordsAvoid"]),
                    samples: short(voice["samples"].as_str().unwrap_or(""), 1500),
                }
            }
            None => BrandCtx::default(),
        };

    let facts = facts::usable(tx)
        .await?
        .into_iter()
        .map(|f| FactCtx {
            id: f.id.to_string(),
            kind: f.kind,
            label: f.label,
            value: f.value,
            price: f.price,
            currency: f.currency,
            ends_at: f.ends_at,
        })
        .collect();

    let media = sqlx::query(
        "SELECT id,name,kind,tags FROM media_assets WHERE deleted_at IS NULL AND status='ready'
         ORDER BY created_at DESC LIMIT 50",
    )
    .fetch_all(&mut **tx)
    .await?
    .iter()
    .map(|r| {
        Ok(MediaCtx {
            id: r.try_get::<Uuid, _>("id")?.to_string(),
            name: short(&r.try_get::<String, _>("name")?, 80),
            kind: r.try_get("kind")?,
            tags: r.try_get("tags")?,
        })
    })
    .collect::<Result<Vec<_>, sqlx::Error>>()?;

    let existing = sqlx::query(
        "SELECT p.scheduled_for,p.platforms,v.content FROM posts p
         JOIN post_versions v ON v.post_id=p.id AND v.version=p.current_version
         WHERE p.deleted_at IS NULL AND p.state<>'canceled' AND p.scheduled_for IS NOT NULL
           AND p.scheduled_for >= $1::date - 1 AND p.scheduled_for < $2::date + 2
         ORDER BY p.scheduled_for LIMIT 100",
    )
    .bind(start)
    .bind(end)
    .fetch_all(&mut **tx)
    .await?
    .iter()
    .map(|r| {
        let content: Value = r.try_get("content")?;
        Ok(ExistingCtx {
            date: r.try_get::<DateTime<Utc>, _>("scheduled_for")?.date_naive(),
            platforms: r.try_get("platforms")?,
            summary: short(content["caption"].as_str().unwrap_or(""), 120),
        })
    })
    .collect::<Result<Vec<_>, sqlx::Error>>()?;

    Ok(Snapshot {
        version: CONTEXT_VERSION,
        timezone,
        start,
        end,
        platforms: platforms.to_vec(),
        brand,
        facts,
        media,
        existing,
    })
}
