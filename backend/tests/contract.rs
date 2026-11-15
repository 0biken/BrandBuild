//! Transport rules from docs/api/openapi.yaml. None of these need a database.
use axum::{
    body::{to_bytes, Body},
    http::{header, Request, StatusCode},
    Router,
};
use brandbuild_backend::{
    api::{self, PostInput, Resource, ResourceKind},
    auth::{cookie_value, set_cookie},
    storage::Storage,
    AppState,
};
use chrono::Utc;
use serde_json::{json, Value};
use sqlx::postgres::PgPoolOptions;
use tower::ServiceExt;
use uuid::Uuid;

fn app() -> Router {
    let pool = PgPoolOptions::new()
        .connect_lazy("postgres://unused@localhost/unused")
        .unwrap();
    api::router(AppState {
        pool,
        storage: Storage::local(std::env::temp_dir().join("brandbuild-test-media")).unwrap(),
        ai: std::sync::Arc::new(brandbuild_backend::ai::Gateway::disabled()),
    })
}

async fn error_of(response: axum::response::Response) -> Value {
    let bytes = to_bytes(response.into_body(), 64 * 1024).await.unwrap();
    serde_json::from_slice::<Value>(&bytes).unwrap()["error"].clone()
}

#[tokio::test]
async fn malformed_json_uses_the_error_shape() {
    let request = Request::post("/v1/auth/login")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from("{"))
        .unwrap();
    let response = app().oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert_eq!(error_of(response).await["code"], "invalid_request");
}

#[tokio::test]
async fn protected_routes_answer_401_in_the_error_shape() {
    let request = Request::get("/v1/auth/session")
        .body(Body::empty())
        .unwrap();
    let response = app().oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(error_of(response).await["code"], "unauthorized");
}

#[tokio::test]
async fn unknown_routes_answer_404_in_the_error_shape() {
    let request = Request::get("/v1/nope").body(Body::empty()).unwrap();
    let response = app().oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    assert_eq!(error_of(response).await["code"], "not_found");
}

#[tokio::test]
async fn logout_clears_the_session_cookie() {
    let request = Request::post("/v1/auth/logout")
        .body(Body::empty())
        .unwrap();
    let response = app().oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    let cookie = response.headers()[header::SET_COOKIE].to_str().unwrap();
    assert!(cookie.starts_with("bb_session=;"));
    assert!(cookie.contains("HttpOnly"));
    assert!(cookie.contains("Max-Age=0"));
}

#[test]
fn cookies_are_read_by_exact_name() {
    let mut headers = axum::http::HeaderMap::new();
    headers.insert(
        header::COOKIE,
        "bb_session_old=x; bb_session=token".parse().unwrap(),
    );
    assert_eq!(
        cookie_value(&headers, "bb_session").as_deref(),
        Some("token")
    );
    assert_eq!(cookie_value(&headers, "bb_reset"), None);
}

#[test]
fn session_cookies_are_http_only_and_lax() {
    let cookie = set_cookie("bb_session", "t", 60);
    assert!(cookie.contains("Path=/; HttpOnly; SameSite=Lax; Max-Age=60"));
}

#[test]
fn resources_serialize_as_camel_case() {
    let now = Utc::now();
    let resource = Resource {
        id: Uuid::new_v4(),
        kind: ResourceKind::Post,
        data: json!({}),
        created_at: now,
        updated_at: now,
    };
    let value = serde_json::to_value(resource).unwrap();
    assert!(value.get("createdAt").is_some());
    assert!(value.get("created_at").is_none());
}

#[test]
fn inputs_read_camel_case_and_keep_their_internal_keys() {
    let input: PostInput = serde_json::from_value(json!({
        "content": {},
        "scheduledFor": "2026-12-01T10:00:00Z",
    }))
    .unwrap();
    assert!(input.scheduled_for.is_some());
    assert!(serde_json::to_value(input)
        .unwrap()
        .get("scheduled_for")
        .is_some());
}
