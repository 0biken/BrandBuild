use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::HashMap, sync::Arc};
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::AppState;

async fn health() -> Json<Value> {
    Json(json!({"status":"ok"}))
}

async fn placeholder() -> Json<Value> {
    Json(json!({"status":"not_implemented", "note":"route scaffold only; authenticate and authorize before accessing tenant data"}))
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ResourceKind {
    Brand,
    Channel,
    Calendar,
    Post,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Resource {
    pub id: Uuid,
    pub kind: ResourceKind,
    pub data: Value,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct BrandInput {
    pub name: String,
    pub website_url: Option<String>,
    #[serde(default)]
    pub voice: Value,
    #[serde(default)]
    pub audience: Value,
    pub guidelines: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct ChannelInput {
    pub provider: String,
    pub display_name: Option<String>,
    pub external_account_id: Option<String>,
    #[serde(default)]
    pub metadata: Value,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct CalendarInput {
    pub name: String,
    pub starts_on: chrono::NaiveDate,
    pub ends_on: chrono::NaiveDate,
    #[serde(default)]
    pub settings: Value,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct PostInput {
    pub content: Value,
    pub channel_id: Option<Uuid>,
    pub scheduled_for: Option<DateTime<Utc>>,
}

#[derive(Clone, Debug, Serialize)]
pub struct ResourceResponse {
    pub data: Resource,
}

#[derive(Clone, Debug, Deserialize)]
pub struct ListQuery {
    pub limit: Option<usize>,
}

#[derive(Clone, Debug, Serialize)]
pub struct ListResponse {
    pub data: Vec<Resource>,
}

#[derive(Clone, Debug, Serialize)]
pub struct AnalyticsResponse {
    pub data: AnalyticsSummary,
}

#[derive(Clone, Debug, Serialize)]
pub struct AnalyticsSummary {
    pub brands: usize,
    pub channels: usize,
    pub calendars: usize,
    pub posts: usize,
}

#[derive(Clone, Debug, Serialize)]
pub struct AuditResponse {
    pub data: Vec<AuditEntry>,
}

#[derive(Clone, Debug, Serialize)]
pub struct AuditEntry {
    pub id: Uuid,
    pub action: String,
    pub resource_type: ResourceKind,
    pub resource_id: Uuid,
    pub created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Serialize)]
pub struct ErrorResponse {
    pub error: ApiErrorBody,
}

#[derive(Clone, Debug, Serialize)]
pub struct ApiErrorBody {
    pub code: &'static str,
    pub message: String,
}

#[derive(Debug, thiserror::Error)]
pub enum ApiError {
    #[error("resource not found")]
    NotFound,
    #[error("request data must be a JSON object")]
    InvalidInput,
    #[error("internal server error")]
    Internal,
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let message = self.to_string();
        let (status, code) = match &self {
            Self::NotFound => (StatusCode::NOT_FOUND, "not_found"),
            Self::InvalidInput => (StatusCode::UNPROCESSABLE_ENTITY, "invalid_input"),
            Self::Internal => (StatusCode::INTERNAL_SERVER_ERROR, "internal_error"),
        };
        let body = Json(ErrorResponse {
            error: ApiErrorBody { code, message },
        });
        (status, body).into_response()
    }
}

#[derive(Clone, Default)]
pub struct V2Store {
    resources: Arc<RwLock<HashMap<Uuid, Resource>>>,
    audit: Arc<RwLock<Vec<AuditEntry>>>,
}

impl V2Store {
    async fn create(&self, kind: ResourceKind, data: Value) -> Result<Resource, ApiError> {
        if !data.is_object() { return Err(ApiError::InvalidInput); }
        let now = Utc::now();
        let resource = Resource { id: Uuid::new_v4(), kind: kind.clone(), data, created_at: now, updated_at: now };
        self.resources.write().await.insert(resource.id, resource.clone());
        self.record("created", kind, resource.id).await;
        Ok(resource)
    }

    async fn get(&self, id: Uuid, kind: ResourceKind) -> Result<Resource, ApiError> {
        self.resources.read().await.get(&id).filter(|r| std::mem::discriminant(&r.kind) == std::mem::discriminant(&kind)).cloned().ok_or(ApiError::NotFound)
    }

    async fn list(&self, kind: ResourceKind, limit: Option<usize>) -> Vec<Resource> {
        let mut values: Vec<_> = self.resources.read().await.values()
            .filter(|r| std::mem::discriminant(&r.kind) == std::mem::discriminant(&kind)).cloned().collect();
        values.sort_by_key(|r| r.created_at);
        values.truncate(limit.unwrap_or(100).clamp(1, 500));
        values
    }

    async fn update(&self, id: Uuid, kind: ResourceKind, data: Value) -> Result<Resource, ApiError> {
        if !data.is_object() { return Err(ApiError::InvalidInput); }
        let mut resources = self.resources.write().await;
        let resource = resources.get_mut(&id)
            .filter(|r| std::mem::discriminant(&r.kind) == std::mem::discriminant(&kind))
            .ok_or(ApiError::NotFound)?;
        resource.data = data;
        resource.updated_at = Utc::now();
        let updated = resource.clone();
        drop(resources);
        self.record("updated", kind, id).await;
        Ok(updated)
    }

    async fn delete(&self, id: Uuid, kind: ResourceKind) -> Result<(), ApiError> {
        let mut resources = self.resources.write().await;
        let exists = resources.get(&id).is_some_and(|r| std::mem::discriminant(&r.kind) == std::mem::discriminant(&kind));
        if !exists { return Err(ApiError::NotFound); }
        resources.remove(&id);
        drop(resources);
        self.record("deleted", kind, id).await;
        Ok(())
    }

    async fn record(&self, action: &str, resource_type: ResourceKind, resource_id: Uuid) {
        self.audit.write().await.push(AuditEntry { id: Uuid::new_v4(), action: action.to_owned(), resource_type, resource_id, created_at: Utc::now() });
    }

    async fn audit(&self, limit: Option<usize>) -> Vec<AuditEntry> {
        let mut rows = self.audit.read().await.clone();
        rows.sort_by_key(|a| a.created_at);
        rows.reverse();
        rows.truncate(limit.unwrap_or(100).clamp(1, 500));
        rows
    }
}

async fn create_resource(State(store): State<V2Store>, kind: ResourceKind, data: Value) -> Result<(StatusCode, Json<ResourceResponse>), ApiError> {
    let resource = store.create(kind, data).await?;
    Ok((StatusCode::CREATED, Json(ResourceResponse { data: resource })))
}

async fn get_resource(State(store): State<V2Store>, Path(id): Path<Uuid>, kind: ResourceKind) -> Result<Json<ResourceResponse>, ApiError> {
    Ok(Json(ResourceResponse { data: store.get(id, kind).await? }))
}

async fn list_resources(State(store): State<V2Store>, Query(query): Query<ListQuery>, kind: ResourceKind) -> Json<ListResponse> {
    Json(ListResponse { data: store.list(kind, query.limit).await })
}

async fn update_resource(State(store): State<V2Store>, id: Uuid, kind: ResourceKind, data: Value) -> Result<Json<ResourceResponse>, ApiError> {
    Ok(Json(ResourceResponse { data: store.update(id, kind, data).await? }))
}

async fn delete_resource(State(store): State<V2Store>, Path(id): Path<Uuid>, kind: ResourceKind) -> Result<StatusCode, ApiError> {
    store.delete(id, kind).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn analytics(State(state): State<AppState>) -> Json<AnalyticsResponse> {
    let store = state.v2;
    Json(AnalyticsResponse { data: AnalyticsSummary {
        brands: store.list(ResourceKind::Brand, None).await.len(),
        channels: store.list(ResourceKind::Channel, None).await.len(),
        calendars: store.list(ResourceKind::Calendar, None).await.len(),
        posts: store.list(ResourceKind::Post, None).await.len(),
    }})
}

async fn audit(State(state): State<AppState>, Query(query): Query<ListQuery>) -> Json<AuditResponse> {
    Json(AuditResponse { data: state.v2.audit(query.limit).await })
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/v1/tenant/config", get(placeholder).put(placeholder))
        .route("/v1/brand", get(placeholder).post(placeholder).put(placeholder))
        .route("/v1/brand/pillars", get(placeholder).post(placeholder))
        .route("/v1/channels", get(placeholder).post(placeholder))
        .route("/v1/channels/:channel_id", get(placeholder).put(placeholder).delete(placeholder))
        .route("/v1/channels/oauth/:provider/start", post(placeholder))
        .route("/v1/channels/oauth/:provider/callback", get(placeholder).post(placeholder))
        .route("/v1/calendar-plans", get(placeholder).post(placeholder))
        .route("/v1/calendar-plans/:plan_id", get(placeholder).put(placeholder).delete(placeholder))
        .route("/v1/calendar-plans/:plan_id/slots", get(placeholder).post(placeholder))
        .route("/v1/calendar-slots/:slot_id", get(placeholder).put(placeholder).delete(placeholder))
        .route("/v1/posts", get(placeholder).post(placeholder))
        .route("/v1/posts/:post_id", get(placeholder).put(placeholder).delete(placeholder))
        .route("/v1/posts/:post_id/approve", post(placeholder))
        .route("/v1/posts/:post_id/request-changes", post(placeholder))
        .route("/v1/posts/:post_id/schedule", post(placeholder))
        .route("/v1/posts/:post_id/cancel", post(placeholder))
        .route("/v1/analytics", get(placeholder))
        .route("/v1/audit", get(placeholder))
        .route("/v2/brands", get(list_brand).post(create_brand))
        .route("/v2/brands/:id", get(get_brand).put(update_brand).delete(delete_brand))
        .route("/v2/channels", get(list_channel).post(create_channel))
        .route("/v2/channels/:id", get(get_channel).put(update_channel).delete(delete_channel))
        .route("/v2/calendars", get(list_calendar).post(create_calendar))
        .route("/v2/calendars/:id", get(get_calendar).put(update_calendar).delete(delete_calendar))
        .route("/v2/posts", get(list_post).post(create_post))
        .route("/v2/posts/:id", get(get_post).put(update_post).delete(delete_post))
        .route("/v2/analytics", get(analytics))
        .route("/v2/audit", get(audit))
        .with_state(state)
}

macro_rules! resource_handlers {
    ($list:ident, $create:ident, $get:ident, $update:ident, $delete:ident, $kind:ident, $input:ty) => {
        async fn $list(State(state): State<AppState>, Query(query): Query<ListQuery>) -> Json<ListResponse> {
            list_resources(State(state.v2), Query(query), ResourceKind::$kind).await
        }
        async fn $create(State(state): State<AppState>, Json(input): Json<$input>) -> Result<(StatusCode, Json<ResourceResponse>), ApiError> {
            create_resource(State(state.v2), ResourceKind::$kind, serde_json::to_value(input).map_err(|_| ApiError::InvalidInput)?).await
        }
        async fn $get(State(state): State<AppState>, Path(id): Path<Uuid>) -> Result<Json<ResourceResponse>, ApiError> {
            get_resource(State(state.v2), Path(id), ResourceKind::$kind).await
        }
        async fn $update(State(state): State<AppState>, Path(id): Path<Uuid>, Json(input): Json<$input>) -> Result<Json<ResourceResponse>, ApiError> {
            update_resource(State(state.v2), id, ResourceKind::$kind, serde_json::to_value(input).map_err(|_| ApiError::InvalidInput)?).await
        }
        async fn $delete(State(state): State<AppState>, Path(id): Path<Uuid>) -> Result<StatusCode, ApiError> {
            delete_resource(State(state.v2), Path(id), ResourceKind::$kind).await
        }
    };
}

resource_handlers!(list_brand, create_brand, get_brand, update_brand, delete_brand, Brand, BrandInput);
resource_handlers!(list_channel, create_channel, get_channel, update_channel, delete_channel, Channel, ChannelInput);
resource_handlers!(list_calendar, create_calendar, get_calendar, update_calendar, delete_calendar, Calendar, CalendarInput);
resource_handlers!(list_post, create_post, get_post, update_post, delete_post, Post, PostInput);
