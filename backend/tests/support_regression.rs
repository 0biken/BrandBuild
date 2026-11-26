use axum::{
    body::{to_bytes, Body},
    http::{Request, StatusCode},
    Router,
};
use brandbuild_backend::{api, db, storage::Storage, AppState};
use serde_json::{json, Value};
use sqlx::{postgres::PgPoolOptions, PgPool};
use tower::ServiceExt;
use uuid::Uuid;

async fn call(
    app: Router,
    method: &str,
    path: &str,
    email: &str,
    body: Value,
) -> (StatusCode, Value) {
    let response = app
        .oneshot(
            Request::builder()
                .method(method)
                .uri(path)
                .header("x-dev-admin-email", email)
                .header("content-type", "application/json")
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let value = serde_json::from_slice(&to_bytes(response.into_body(), 65536).await.unwrap())
        .unwrap_or(Value::Null);
    (status, value)
}
fn router(pool: &PgPool) -> Router {
    api::router(AppState {
        pool: pool.clone(),
        admin_pool: pool.clone(),
        storage: Storage::local(std::env::temp_dir().join("bb-support-test")).unwrap(),
        ai: std::sync::Arc::new(brandbuild_backend::ai::Gateway::disabled()),
    })
}

#[tokio::test]
async fn support_edits_preserve_versioned_content_and_require_live_approval() {
    let Ok(url) = std::env::var("TEST_DATABASE_URL") else {
        return;
    };
    std::env::set_var("ALLOW_DEV_ADMIN_AUTH", "true");
    let pool = PgPoolOptions::new()
        .max_connections(4)
        .connect(&url)
        .await
        .unwrap();
    db::migrate(&pool).await.unwrap();
    let admin = PgPoolOptions::new()
        .max_connections(4)
        .after_connect(|conn, _| {
            Box::pin(async move {
                sqlx::query("SET ROLE brandbuild_admin")
                    .execute(conn)
                    .await?;
                Ok(())
            })
        })
        .connect(&url)
        .await
        .unwrap();

    let tenant = Uuid::new_v4();
    let owner = Uuid::new_v4();
    sqlx::query("INSERT INTO tenants(id,name,slug) VALUES($1,'Support Test',$2)")
        .bind(tenant)
        .bind(tenant.to_string())
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO users(id,email) VALUES($1,$2)")
        .bind(owner)
        .bind(format!("{owner}@example.test"))
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO tenant_memberships(tenant_id,user_id,role) VALUES($1,$2,'owner')")
        .bind(tenant)
        .bind(owner)
        .execute(&pool)
        .await
        .unwrap();
    let staff = Uuid::new_v4();
    let approver = Uuid::new_v4();
    let email = format!("{staff}@brandbuild.co");
    sqlx::query("INSERT INTO admin.staff_users(id,email,display_name,roles) VALUES($1,$2,'Support',ARRAY['support']),($3,$4,'Approver',ARRAY['operations'])")
        .bind(staff).bind(&email).bind(approver).bind(format!("{approver}@brandbuild.co")).execute(&pool).await.unwrap();
    let post: Uuid =
        sqlx::query_scalar("INSERT INTO posts(tenant_id,title) VALUES($1,'Original') RETURNING id")
            .bind(tenant)
            .fetch_one(&pool)
            .await
            .unwrap();
    let original = json!({"schema":"social_content.v1","caption":"Original caption","hashtags":["#brand"],"aspectRatio":"4 / 5","media":[],"mediaSha256":[],"source":{"model":"test"},"altText":"Original alt"});
    sqlx::query("INSERT INTO post_versions(tenant_id,post_id,version,content) VALUES($1,$2,1,$3)")
        .bind(tenant)
        .bind(post)
        .bind(&original)
        .execute(&pool)
        .await
        .unwrap();
    let session: Uuid = sqlx::query_scalar("INSERT INTO admin.support_sessions(tenant_id,mode,ticket_ref,reason,status,requested_by,approved_by) VALUES($1,'read_write','SUP-123','Fix content','approved',$2,$3) RETURNING id").bind(tenant).bind(staff).bind(approver).fetch_one(&pool).await.unwrap();
    let (status, _) = call(
        router(&admin),
        "POST",
        &format!("/admin/v1/support-sessions/{session}/activate"),
        &email,
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let delivered: Option<chrono::DateTime<chrono::Utc>> =
        sqlx::query_scalar("SELECT customer_notified_at FROM admin.support_sessions WHERE id=$1")
            .bind(session)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(
        delivered.is_none(),
        "queueing an email must not claim delivery"
    );
    let count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM admin.support_notification_outbox WHERE support_session_id=$1",
    )
    .bind(session)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(count, 1);
    let (status, view) = call(
        router(&admin),
        "GET",
        &format!("/admin/v1/support-sessions/{session}/workspace"),
        &email,
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{view}");
    let (status, body) = call(
        router(&admin),
        "PATCH",
        &format!("/admin/v1/support-sessions/{session}/drafts/{post}"),
        &email,
        json!({"title":"Updated","body":"New caption"}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let (version, stored, hash, actor, attributed): (i32,Value,Option<String>,Option<Uuid>,Option<Uuid>) = sqlx::query_as("SELECT p.current_version,v.content,v.content_hash,v.created_by,v.staff_actor_id FROM posts p JOIN post_versions v ON v.post_id=p.id AND v.version=p.current_version WHERE p.id=$1").bind(post).fetch_one(&pool).await.unwrap();
    let mut expected = original.clone();
    expected["caption"] = json!("New caption");
    assert_eq!(version, 2);
    assert_eq!(stored, expected);
    assert_eq!(
        hash,
        Some(brandbuild_backend::domain::content_hash(&stored))
    );
    assert_eq!(actor, None);
    assert_eq!(attributed, Some(staff));
    // The database mutation itself rejects an expired session, even if a caller bypasses the HTTP guard.
    sqlx::query(
        "UPDATE admin.support_sessions SET expires_at=now()-interval '1 second' WHERE id=$1",
    )
    .bind(session)
    .execute(&pool)
    .await
    .unwrap();
    let refused: Value =
        sqlx::query_scalar("SELECT admin.support_update_draft($1,$2,'Blocked',$3,$4,$5,$6,2)")
            .bind(tenant)
            .bind(post)
            .bind(&stored)
            .bind(brandbuild_backend::domain::content_hash(&stored))
            .bind(staff)
            .bind(session)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(refused["reason"], "forbidden");
    sqlx::query(
        "UPDATE admin.support_sessions SET expires_at=now()+interval '30 minutes' WHERE id=$1",
    )
    .bind(session)
    .execute(&pool)
    .await
    .unwrap();
    // A missing SMTP configuration leaves the durable notice pending and never claims delivery.
    std::env::remove_var("SMTP_HOST");
    brandbuild_backend::admin::support_email::deliver_pending(&admin)
        .await
        .unwrap();
    let (attempts, delivered): (i32, Option<chrono::DateTime<chrono::Utc>>) = sqlx::query_as("SELECT attempts,delivered_at FROM admin.support_notification_outbox WHERE support_session_id=$1").bind(session).fetch_one(&pool).await.unwrap();
    assert_eq!(attempts, 1);
    assert!(delivered.is_none());
    sqlx::query("UPDATE admin.staff_users SET roles=ARRAY['student_reviewer'] WHERE id=$1")
        .bind(approver)
        .execute(&pool)
        .await
        .unwrap();
    let (status, _) = call(
        router(&admin),
        "PATCH",
        &format!("/admin/v1/support-sessions/{session}/drafts/{post}"),
        &email,
        json!({"title":"Blocked","body":"Blocked"}),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let status: String =
        sqlx::query_scalar("SELECT status FROM admin.support_sessions WHERE id=$1")
            .bind(session)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(status, "revoked");
    // Logout revocation also cancels support access in the same database transaction.
    let readonly: Uuid = sqlx::query_scalar("INSERT INTO admin.support_sessions(tenant_id,mode,ticket_ref,reason,status,requested_by,activated_at,expires_at) VALUES($1,'read_only','SUP-logout','Read workspace','active',$2,now(),now()+interval '30 minutes') RETURNING id").bind(tenant).bind(staff).fetch_one(&pool).await.unwrap();
    let login: Uuid = sqlx::query_scalar("INSERT INTO admin.staff_sessions(staff_user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '1 hour') RETURNING id").bind(staff).bind(Uuid::new_v4().to_string()).fetch_one(&pool).await.unwrap();
    sqlx::query("UPDATE admin.staff_sessions SET revoked_at=now() WHERE id=$1")
        .bind(login)
        .execute(&pool)
        .await
        .unwrap();
    let status: String =
        sqlx::query_scalar("SELECT status FROM admin.support_sessions WHERE id=$1")
            .bind(readonly)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(status, "revoked");
    // Activation rolls back when an owner notification cannot be queued.
    let unnotifiable: Uuid = sqlx::query_scalar("INSERT INTO admin.support_sessions(tenant_id,mode,ticket_ref,reason,status,requested_by) VALUES($1,'read_only','SUP-missing-owner','Read workspace','approved',$2) RETURNING id").bind(tenant).bind(staff).fetch_one(&pool).await.unwrap();
    sqlx::query("DELETE FROM tenant_memberships WHERE tenant_id=$1")
        .bind(tenant)
        .execute(&pool)
        .await
        .unwrap();
    let (status, _) = call(
        router(&admin),
        "POST",
        &format!("/admin/v1/support-sessions/{unnotifiable}/activate"),
        &email,
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    let (status, queued): (String, Option<chrono::DateTime<chrono::Utc>>) = sqlx::query_as(
        "SELECT status,customer_notification_queued_at FROM admin.support_sessions WHERE id=$1",
    )
    .bind(unnotifiable)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(status, "approved");
    assert!(queued.is_none());
}
