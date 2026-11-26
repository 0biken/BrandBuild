use axum::{
    body::{to_bytes, Body},
    http::{Request, StatusCode},
};
use brandbuild_backend::{api, db, storage::Storage, AppState};
use serde_json::{json, Value};
use sqlx::{postgres::PgPoolOptions, PgPool};
use tower::ServiceExt;
use uuid::Uuid;

async fn pools() -> Option<(PgPool, PgPool, PgPool)> {
    let url = std::env::var("TEST_DATABASE_URL").ok()?;
    let owner = PgPoolOptions::new()
        .max_connections(2)
        .connect(&url)
        .await
        .unwrap();
    db::migrate(&owner).await.unwrap();
    sqlx::query("ALTER ROLE brandbuild_app LOGIN PASSWORD 'brandbuild_app'")
        .execute(&owner)
        .await
        .unwrap();
    sqlx::query("ALTER ROLE brandbuild_admin LOGIN PASSWORD 'brandbuild_admin'")
        .execute(&owner)
        .await
        .unwrap();
    let app = PgPoolOptions::new()
        .max_connections(2)
        .connect(&std::env::var("TEST_APP_DATABASE_URL").unwrap())
        .await
        .unwrap();
    let admin = PgPoolOptions::new()
        .max_connections(2)
        .connect(&std::env::var("TEST_ADMIN_DATABASE_URL").unwrap())
        .await
        .unwrap();
    Some((owner, app, admin))
}

#[tokio::test]
async fn production_roles_can_use_admin_functions_without_exposing_staff_tables() {
    let Some((owner, app, admin)) = pools().await else {
        return;
    };
    let overview: Value = sqlx::query_scalar("SELECT admin.overview_summary()")
        .fetch_one(&admin)
        .await
        .expect("admin definer must have its required table grants");
    assert!(overview.is_object());
    assert!(sqlx::query("SELECT * FROM admin.staff_users")
        .execute(&app)
        .await
        .is_err());
    assert!(sqlx::query("SELECT admin.overview_summary()")
        .execute(&app)
        .await
        .is_err());
    let holds: Value = sqlx::query_scalar("SELECT admin.active_holds_for_target($1,NULL)")
        .bind(Uuid::new_v4())
        .fetch_one(&app)
        .await
        .expect("customer can execute narrowly granted functions");
    assert!(holds.is_array());
    sqlx::query("SELECT id FROM admin.ai_policies")
        .execute(&admin)
        .await
        .unwrap();
    sqlx::query("SELECT id FROM admin.support_sessions")
        .execute(&admin)
        .await
        .unwrap();
    let role: bool =
        sqlx::query_scalar("SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user")
            .fetch_one(&admin)
            .await
            .unwrap();
    assert!(!role);
    owner.close().await;
}

#[tokio::test]
async fn customer_notices_return_json_arrays_using_production_roles() {
    let Some((owner, app, admin)) = pools().await else {
        return;
    };
    std::env::set_var("ALLOW_DEV_AUTH", "true");
    let tenant = Uuid::new_v4();
    let user = Uuid::new_v4();
    sqlx::query("INSERT INTO tenants(id,name,slug) VALUES($1,'Notices',$2)")
        .bind(tenant)
        .bind(tenant.to_string())
        .execute(&owner)
        .await
        .unwrap();
    sqlx::query("INSERT INTO users(id,email) VALUES($1,$2)")
        .bind(user)
        .bind(format!("{user}@example.test"))
        .execute(&owner)
        .await
        .unwrap();
    sqlx::query("INSERT INTO tenant_memberships(tenant_id,user_id,role) VALUES($1,$2,'owner')")
        .bind(tenant)
        .bind(user)
        .execute(&owner)
        .await
        .unwrap();
    let state = AppState {
        pool: app,
        admin_pool: admin,
        storage: Storage::local(std::env::temp_dir().join("bb-notices-regression")).unwrap(),
        ai: std::sync::Arc::new(brandbuild_backend::ai::Gateway::disabled()),
    };
    let response = api::router(state)
        .oneshot(
            Request::builder()
                .uri("/v1/notices")
                .header("x-dev-tenant-id", tenant.to_string())
                .header("x-dev-actor-id", user.to_string())
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let body: Value =
        serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap()).unwrap();
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(body["data"]["incidents"].is_array(), "{}", json!(body));
    assert!(body["data"]["holds"].is_array());
}

#[tokio::test]
async fn approved_publish_queues_exactly_one_attempt_and_event() {
    let Some((owner, app, admin)) = pools().await else {
        return;
    };
    std::env::set_var("ALLOW_DEV_AUTH", "true");
    let tenant = Uuid::new_v4();
    let user = Uuid::new_v4();
    let post = Uuid::new_v4();
    let content = json!({"schema":"social_content.v1","caption":"Approved copy","hashtags":[],"media":[],"aspectRatio":"1:1"});
    let hash = brandbuild_backend::domain::content_hash(&content);
    sqlx::query("INSERT INTO tenants(id,name,slug) VALUES($1,'Publish',$2)")
        .bind(tenant)
        .bind(tenant.to_string())
        .execute(&owner)
        .await
        .unwrap();
    sqlx::query("INSERT INTO users(id,email) VALUES($1,$2)")
        .bind(user)
        .bind(format!("{user}@example.test"))
        .execute(&owner)
        .await
        .unwrap();
    sqlx::query("INSERT INTO tenant_memberships(tenant_id,user_id,role) VALUES($1,$2,'owner')")
        .bind(tenant)
        .bind(user)
        .execute(&owner)
        .await
        .unwrap();
    sqlx::query("INSERT INTO posts(id,tenant_id,title,platforms,state,created_by) VALUES($1,$2,'Approved',ARRAY['ig'],'approved',$3)").bind(post).bind(tenant).bind(user).execute(&owner).await.unwrap();
    let version: Uuid = sqlx::query_scalar("INSERT INTO post_versions(tenant_id,post_id,version,content,content_hash,created_by) VALUES($1,$2,1,$3,$4,$5) RETURNING id").bind(tenant).bind(post).bind(&content).bind(&hash).bind(user).fetch_one(&owner).await.unwrap();
    sqlx::query("INSERT INTO approvals(tenant_id,post_id,post_version_id,reviewer_id,decision,content_hash) VALUES($1,$2,$3,$4,'approved',$5)").bind(tenant).bind(post).bind(version).bind(user).bind(&hash).execute(&owner).await.unwrap();
    let state = AppState {
        pool: app,
        admin_pool: admin,
        storage: Storage::local(std::env::temp_dir().join("bb-publish-regression")).unwrap(),
        ai: std::sync::Arc::new(brandbuild_backend::ai::Gateway::disabled()),
    };
    let router = api::router(state);
    for _ in 0..2 {
        let res = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!("/v1/posts/{post}/publish"))
                    .header("x-dev-tenant-id", tenant.to_string())
                    .header("x-dev-actor-id", user.to_string())
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        let body: Value =
            serde_json::from_slice(&to_bytes(res.into_body(), usize::MAX).await.unwrap()).unwrap();
        assert_eq!(body["data"]["state"], "queued");
    }
    let attempts: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM publish_attempts WHERE tenant_id=$1 AND state='queued'",
    )
    .bind(tenant)
    .fetch_one(&owner)
    .await
    .unwrap();
    let events: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM outbox WHERE tenant_id=$1 AND topic='post.publish'",
    )
    .bind(tenant)
    .fetch_one(&owner)
    .await
    .unwrap();
    assert_eq!((attempts, events), (1, 1));
}
