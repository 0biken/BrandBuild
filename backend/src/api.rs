use axum::{
    routing::{get, post},
    Json, Router,
};
use serde_json::{json, Value};
use crate::AppState;

async fn health() -> Json<Value> { Json(json!({"status":"ok"})) }
async fn placeholder() -> Json<Value> {
    Json(json!({"status":"not_implemented", "note":"route scaffold only; authenticate and authorize before accessing tenant data"}))
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
        .with_state(state)
}
