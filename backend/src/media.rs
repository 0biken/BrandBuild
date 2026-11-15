//! Photo and video library (docs/api/openapi.yaml, tag `media`).
//! Files go to object storage (see storage.rs); the row here says what and whose they are.
use std::collections::HashMap;

use axum::{
    body::Body,
    extract::{DefaultBodyLimit, Multipart, Path, Query, State},
    http::{header, StatusCode},
    response::{IntoResponse, Redirect, Response},
    routing::{delete, get},
    Json, Router,
};
use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::{postgres::PgRow, Postgres, Row, Transaction};
use uuid::Uuid;

use crate::{api::ApiError, audit, auth::TenantContext, db::tenant_tx, outbox, AppState};

type Tx = Transaction<'static, Postgres>;

/// The same limits the web app checks before uploading (src/lib/api/media.ts).
pub const IMAGE_MAX_BYTES: u64 = 10 * 1024 * 1024;
pub const VIDEO_MAX_BYTES: u64 = 200 * 1024 * 1024;
const COLUMNS: &str = "id,name,kind,mime,size,duration,created_at,sha256,status,tags";
const MAX_TAGS: usize = 20;

/// The file's real type, read from its first bytes. The name and the browser's claim are ignored.
pub fn sniff(head: &[u8]) -> Option<(&'static str, &'static str)> {
    if head.starts_with(&[0xFF, 0xD8, 0xFF]) {
        return Some(("image", "image/jpeg"));
    }
    if head.starts_with(&[0x89, b'P', b'N', b'G']) {
        return Some(("image", "image/png"));
    }
    if head.starts_with(b"GIF8") {
        return Some(("image", "image/gif"));
    }
    if head.len() >= 12 && &head[0..4] == b"RIFF" && &head[8..12] == b"WEBP" {
        return Some(("image", "image/webp"));
    }
    if head.starts_with(&[0x1A, 0x45, 0xDF, 0xA3]) {
        return Some(("video", "video/webm"));
    }
    if head.len() >= 12 && &head[4..8] == b"ftyp" {
        return Some(match &head[8..12] {
            b"heic" | b"heix" | b"hevc" | b"hevx" => ("image", "image/heic"),
            b"mif1" | b"msf1" | b"heif" => ("image", "image/heif"),
            b"qt  " => ("video", "video/quicktime"),
            _ => ("video", "video/mp4"),
        });
    }
    None
}

fn media_json(row: &PgRow) -> Result<Value, ApiError> {
    let id: Uuid = row.try_get("id")?;
    let mut out = json!({
        "id": id,
        "name": row.try_get::<String, _>("name")?,
        "kind": row.try_get::<String, _>("kind")?,
        "type": row.try_get::<String, _>("mime")?,
        "size": row.try_get::<i64, _>("size")?,
        "addedAt": row.try_get::<DateTime<Utc>, _>("created_at")?.to_rfc3339(),
        // Relative to the API root; the web app adds its `/api` prefix.
        "url": format!("/v1/media/{id}/file"),
        "status": row.try_get::<String, _>("status")?,
        "tags": row.try_get::<Vec<String>, _>("tags")?,
    });
    if let Some(hash) = row.try_get::<Option<String>, _>("sha256")? {
        out["sha256"] = json!(hash);
    }
    if let Some(duration) = row.try_get::<Option<f32>, _>("duration")? {
        out["duration"] = json!(duration);
    }
    Ok(out)
}

/// Media refs by id, including files removed from the library that posts still use.
pub async fn load_refs(tx: &mut Tx, ids: &[Uuid]) -> Result<HashMap<Uuid, Value>, ApiError> {
    if ids.is_empty() {
        return Ok(HashMap::new());
    }
    let rows = sqlx::query(&format!(
        "SELECT {COLUMNS} FROM media_assets WHERE id=ANY($1)"
    ))
    .bind(ids)
    .fetch_all(&mut **tx)
    .await?;
    let mut out = HashMap::new();
    for row in &rows {
        out.insert(row.try_get("id")?, media_json(row)?);
    }
    Ok(out)
}

/// Each file's sha256, in the order given (`None` for files uploaded before hashing).
pub async fn hashes(tx: &mut Tx, ids: &[Uuid]) -> Result<Vec<Option<String>>, ApiError> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let rows = sqlx::query("SELECT id,sha256 FROM media_assets WHERE id=ANY($1)")
        .bind(ids)
        .fetch_all(&mut **tx)
        .await?;
    let mut found: HashMap<Uuid, Option<String>> = HashMap::new();
    for row in rows {
        found.insert(row.try_get("id")?, row.try_get("sha256")?);
    }
    Ok(ids
        .iter()
        .map(|id| found.get(id).cloned().flatten())
        .collect())
}

/// Marks a quarantined upload ready once it has been scanned. There is no virus scanner
/// yet, so the scan step passes every file whose type was already checked on upload;
/// a real scanner plugs in here and sets `blocked` instead.
pub async fn finish_scan(pool: &sqlx::PgPool, tenant: Uuid, media: Uuid) -> Result<(), ApiError> {
    let mut tx = tenant_tx(pool, tenant).await?;
    sqlx::query("UPDATE media_assets SET status='ready' WHERE id=$1 AND status='quarantine'")
        .bind(media)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(())
}

/// Fails unless every id is a file in this workspace's library.
pub async fn check_ids(tx: &mut Tx, ids: &[Uuid]) -> Result<(), ApiError> {
    if ids.is_empty() {
        return Ok(());
    }
    let found: i64 = sqlx::query_scalar(
        "SELECT count(DISTINCT id) FROM media_assets WHERE id=ANY($1) AND deleted_at IS NULL AND status<>'blocked'",
    )
    .bind(ids)
    .fetch_one(&mut **tx)
    .await?;
    let mut unique = ids.to_vec();
    unique.sort();
    unique.dedup();
    if found as usize == unique.len() {
        Ok(())
    } else {
        Err(ApiError::InvalidInput)
    }
}

#[derive(Deserialize)]
struct ListQuery {
    tag: Option<String>,
}

async fn list_media(
    State(s): State<AppState>,
    ctx: TenantContext,
    Query(q): Query<ListQuery>,
) -> Result<Json<Value>, ApiError> {
    let mut tx = tenant_tx(&s.pool, ctx.tenant_id).await?;
    let rows = sqlx::query(&format!(
        "SELECT {COLUMNS} FROM media_assets WHERE deleted_at IS NULL AND ($1::text IS NULL OR $1=ANY(tags))
         ORDER BY created_at DESC, id"
    ))
    .bind(q.tag.as_deref().map(normalise_tag).filter(|t| !t.is_empty()))
    .fetch_all(&mut *tx)
    .await?;
    tx.commit().await?;
    let data = rows.iter().map(media_json).collect::<Result<Vec<_>, _>>()?;
    Ok(Json(json!({ "data": data })))
}

/// Streams the upload to storage, checking its real type and size on the way.
async fn add_media(
    State(s): State<AppState>,
    ctx: TenantContext,
    mut multipart: Multipart,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let mut field = loop {
        match multipart
            .next_field()
            .await
            .map_err(|_| ApiError::InvalidInput)?
        {
            Some(field) if field.name() == Some("file") => break field,
            Some(_) => continue,
            None => return Err(ApiError::InvalidInput),
        }
    };
    let name: String = field
        .file_name()
        .unwrap_or("upload")
        .chars()
        .filter(|c| !c.is_control() && !matches!(c, '/' | '\\'))
        .take(200)
        .collect();

    // Gather enough of the start to recognise the type before storing anything.
    let mut head: Vec<u8> = Vec::new();
    let mut ended = false;
    while head.len() < 12 {
        match field.chunk().await.map_err(|_| ApiError::InvalidInput)? {
            Some(chunk) => head.extend_from_slice(&chunk),
            None => {
                ended = true;
                break;
            }
        }
    }
    let (kind, mime) = sniff(&head).ok_or(ApiError::InvalidInput)?;
    let limit = if kind == "image" {
        IMAGE_MAX_BYTES
    } else {
        VIDEO_MAX_BYTES
    };

    let id = Uuid::new_v4();
    let key = format!("{}/{id}", ctx.tenant_id);
    let mut upload = s.storage.begin(&key).await?;
    let mut size = head.len() as u64;
    let mut hasher = Sha256::new();
    hasher.update(&head);
    upload.write(&head);
    while !ended && size <= limit {
        match field.chunk().await {
            Ok(Some(chunk)) => {
                size += chunk.len() as u64;
                hasher.update(&chunk);
                upload
                    .wait_for_capacity(4)
                    .await
                    .map_err(crate::storage::StorageError::from)?;
                upload.put(chunk);
            }
            Ok(None) => ended = true,
            Err(_) => {
                let _ = upload.abort().await;
                return Err(ApiError::InvalidInput);
            }
        }
    }
    if size > limit {
        let _ = upload.abort().await;
        return Err(ApiError::InvalidInput);
    }
    upload
        .finish()
        .await
        .map_err(crate::storage::StorageError::from)?;

    let sha256 = format!("{:x}", hasher.finalize());
    let mut tx = tenant_tx(&s.pool, ctx.tenant_id).await?;
    let row = sqlx::query(&format!(
        "INSERT INTO media_assets(id,tenant_id,name,kind,mime,size,storage_key,created_by,sha256,status)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'quarantine') RETURNING {COLUMNS}"
    ))
    .bind(id)
    .bind(ctx.tenant_id)
    .bind(if name.is_empty() { "upload" } else { name.as_str() })
    .bind(kind)
    .bind(mime)
    .bind(size as i64)
    .bind(&key)
    .bind(ctx.actor_id)
    .bind(&sha256)
    .fetch_one(&mut *tx)
    .await?;
    audit::record(
        &mut tx,
        &ctx,
        "media_uploaded",
        "media",
        id,
        json!({ "sha256": sha256, "size": size }),
    )
    .await?;
    outbox::enqueue(
        &mut tx,
        ctx.tenant_id,
        "media.scan",
        json!({ "media_id": id }),
    )
    .await?;
    tx.commit().await?;
    Ok((
        StatusCode::CREATED,
        Json(json!({ "data": media_json(&row)? })),
    ))
}

/// Removes a file from the library. Posts that already use it keep working.
async fn remove_media(
    State(s): State<AppState>,
    ctx: TenantContext,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
    let id = Uuid::parse_str(&id).map_err(|_| ApiError::NotFound)?;
    let mut tx = tenant_tx(&s.pool, ctx.tenant_id).await?;
    let removed =
        sqlx::query("UPDATE media_assets SET deleted_at=now() WHERE id=$1 AND deleted_at IS NULL")
            .bind(id)
            .execute(&mut *tx)
            .await?
            .rows_affected();
    if removed == 0 {
        return Err(ApiError::NotFound);
    }
    audit::record(&mut tx, &ctx, "media_deleted", "media", id, json!({})).await?;
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

fn normalise_tag(tag: &str) -> String {
    tag.trim()
        .trim_start_matches('#')
        .to_lowercase()
        .chars()
        .take(40)
        .collect()
}

#[derive(Deserialize)]
struct TagsInput {
    tags: Vec<String>,
}

/// Replaces a file's tags.
async fn set_tags(
    State(s): State<AppState>,
    ctx: TenantContext,
    Path(id): Path<String>,
    Json(input): Json<TagsInput>,
) -> Result<Json<Value>, ApiError> {
    let id = Uuid::parse_str(&id).map_err(|_| ApiError::NotFound)?;
    let mut tags: Vec<String> = input
        .tags
        .iter()
        .map(|t| normalise_tag(t))
        .filter(|t| !t.is_empty())
        .collect();
    tags.sort();
    tags.dedup();
    if tags.len() > MAX_TAGS {
        return Err(ApiError::InvalidInput);
    }
    let mut tx = tenant_tx(&s.pool, ctx.tenant_id).await?;
    let row = sqlx::query(&format!(
        "UPDATE media_assets SET tags=$2 WHERE id=$1 AND deleted_at IS NULL RETURNING {COLUMNS}"
    ))
    .bind(id)
    .bind(&tags)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or(ApiError::NotFound)?;
    tx.commit().await?;
    Ok(Json(json!({ "data": media_json(&row)? })))
}

/// The file itself, for members of the workspace only: a short-lived signed link on S3,
/// or the bytes streamed from the local folder.
async fn media_file(
    State(s): State<AppState>,
    ctx: TenantContext,
    Path(id): Path<String>,
) -> Result<Response, ApiError> {
    let id = Uuid::parse_str(&id).map_err(|_| ApiError::NotFound)?;
    let mut tx = tenant_tx(&s.pool, ctx.tenant_id).await?;
    let row = sqlx::query("SELECT storage_key,mime,size FROM media_assets WHERE id=$1")
        .bind(id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or(ApiError::NotFound)?;
    tx.commit().await?;
    let key: String = row.try_get("storage_key")?;
    if let Some(url) = s.storage.signed_url(&key).await? {
        return Ok(Redirect::temporary(&url).into_response());
    }
    let stream = s.storage.stream(&key).await?;
    Ok((
        [
            (header::CONTENT_TYPE, row.try_get::<String, _>("mime")?),
            (
                header::CONTENT_LENGTH,
                row.try_get::<i64, _>("size")?.to_string(),
            ),
            (header::CACHE_CONTROL, "private, max-age=3600".to_owned()),
            (header::X_CONTENT_TYPE_OPTIONS, "nosniff".to_owned()),
        ],
        Body::from_stream(stream),
    )
        .into_response())
}

/// Mounted inside the authenticated `/v1` router.
pub fn routes() -> Router<AppState> {
    Router::new()
        .route(
            "/media",
            get(list_media).post(add_media).layer(DefaultBodyLimit::max(
                (VIDEO_MAX_BYTES + 1024 * 1024) as usize,
            )),
        )
        .route("/media/:media_id", delete(remove_media).patch(set_tags))
        .route("/media/:media_id/file", get(media_file))
}

#[cfg(test)]
mod tests {
    use super::sniff;

    #[test]
    fn recognises_files_by_their_first_bytes() {
        assert_eq!(
            sniff(&[0xFF, 0xD8, 0xFF, 0xE0]),
            Some(("image", "image/jpeg"))
        );
        assert_eq!(sniff(b"\x89PNG\r\n\x1a\n"), Some(("image", "image/png")));
        assert_eq!(
            sniff(b"RIFF\0\0\0\0WEBPVP8 "),
            Some(("image", "image/webp"))
        );
        assert_eq!(sniff(b"\0\0\0\x18ftypmp42"), Some(("video", "video/mp4")));
        assert_eq!(
            sniff(b"\0\0\0\x14ftypqt  "),
            Some(("video", "video/quicktime"))
        );
        assert_eq!(sniff(b"\0\0\0\x18ftypheic"), Some(("image", "image/heic")));
    }

    #[test]
    fn refuses_everything_else() {
        assert_eq!(sniff(b"<svg xmlns="), None);
        assert_eq!(sniff(b"MZ\x90\0\x03\0\0\0\x04\0\0\0"), None);
        assert_eq!(sniff(b"%PDF-1.7\n....."), None);
        assert_eq!(sniff(b""), None);
    }
}
