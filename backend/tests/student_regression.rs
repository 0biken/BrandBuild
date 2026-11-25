use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use brandbuild_backend::{api, db, storage::Storage, AppState};
use sqlx::{postgres::PgPoolOptions, PgPool};
use tower::ServiceExt;
use uuid::Uuid;

async fn pool() -> Option<PgPool> {
    let url = std::env::var("TEST_DATABASE_URL").ok()?;
    let p = PgPoolOptions::new()
        .max_connections(3)
        .connect(&url)
        .await
        .unwrap();
    db::migrate(&p).await.unwrap();
    Some(p)
}
async fn fixture(p: &PgPool) -> (Uuid, Uuid) {
    let (tenant, user) = (Uuid::new_v4(), Uuid::new_v4());
    sqlx::query("INSERT INTO tenants(id,name,slug) VALUES($1,'Student test',$2)")
        .bind(tenant)
        .bind(tenant.to_string())
        .execute(p)
        .await
        .unwrap();
    sqlx::query("INSERT INTO users(id,email,email_verified_at) VALUES($1,$2,now())")
        .bind(user)
        .bind(format!("{user}@example.test"))
        .execute(p)
        .await
        .unwrap();
    sqlx::query("INSERT INTO tenant_memberships(tenant_id,user_id,role) VALUES($1,$2,'owner')")
        .bind(tenant)
        .bind(user)
        .execute(p)
        .await
        .unwrap();
    (tenant, user)
}
#[tokio::test]
async fn unavailable_scanner_cannot_create_ready_submission() {
    let Some(p) = pool().await else { return };
    std::env::set_var("ALLOW_DEV_AUTH", "true");
    std::env::set_var(
        "STUDENT_ID_SCANNER",
        "brandbuild-scanner-that-does-not-exist",
    );
    let (tenant, user) = fixture(&p).await;
    let app = api::router(AppState {
        pool: p.clone(),
        admin_pool: p.clone(),
        storage: Storage::local(std::env::temp_dir().join(format!("student-test-{tenant}")))
            .unwrap(),
        ai: std::sync::Arc::new(brandbuild_backend::ai::Gateway::disabled()),
    });
    let body = "--bb\r\nContent-Disposition: form-data; name=\"applicantName\"\r\n\r\nAda\r\n--bb\r\nContent-Disposition: form-data; name=\"school\"\r\n\r\nUniversity\r\n--bb\r\nContent-Disposition: form-data; name=\"cardExpiryDate\"\r\n\r\n2030-01-01\r\n--bb\r\nContent-Disposition: form-data; name=\"file\"; filename=\"id.png\"\r\nContent-Type: image/png\r\n\r\n\u{89}PNG\r\n\u{1a}\nhello\r\n--bb--\r\n";
    let mut bytes = body.as_bytes().to_vec();
    // UTF-8 U+0089 above must be the PNG magic's single byte.
    let pos = bytes.windows(2).position(|b| b == [0xc2, 0x89]).unwrap();
    bytes.remove(pos);
    let res = app
        .clone()
        .oneshot(
            Request::post("/v1/student-check/id")
                .header("x-dev-tenant-id", tenant.to_string())
                .header("x-dev-actor-id", user.to_string())
                .header("content-type", "multipart/form-data; boundary=bb")
                .body(Body::from(bytes.clone()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::SERVICE_UNAVAILABLE);
    let n: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM student_submissions WHERE tenant_id=$1 AND scan_status='ready'",
    )
    .bind(tenant)
    .fetch_one(&p)
    .await
    .unwrap();
    assert_eq!(n, 0);
    // This executable is a test fixture for the external scanner protocol.
    // Production has no scanner bypass.
    #[cfg(windows)]
    let scanner = {
        let path = std::env::temp_dir().join(format!("clean-scanner-{tenant}.cmd"));
        std::fs::write(&path, "@exit /b 0\r\n").unwrap();
        path
    };
    #[cfg(unix)]
    let scanner = {
        use std::os::unix::fs::PermissionsExt;
        let path = std::env::temp_dir().join(format!("clean-scanner-{tenant}"));
        std::fs::write(&path, "#!/bin/sh\nexit 0\n").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700)).unwrap();
        path
    };
    std::env::set_var("STUDENT_ID_SCANNER", &scanner);
    let res = app
        .oneshot(
            Request::post("/v1/student-check/id")
                .header("x-dev-tenant-id", tenant.to_string())
                .header("x-dev-actor-id", user.to_string())
                .header("content-type", "multipart/form-data; boundary=bb")
                .body(Body::from(bytes))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::CREATED);
    let state: (String, String) =
        sqlx::query_as("SELECT status,method FROM student_checks WHERE tenant_id=$1")
            .bind(tenant)
            .fetch_one(&p)
            .await
            .unwrap();
    assert_eq!(state, ("pending_review".into(), "id".into()));
    std::fs::remove_file(scanner).unwrap();
}
#[tokio::test]
async fn review_decisions_use_schema_methods_and_preserve_paid_plan() {
    let Some(p) = pool().await else { return };
    for decision in ["approved", "rejected"] {
        let (tenant, user) = fixture(&p).await;
        sqlx::query("UPDATE tenants SET plan='business',plan_paid_until=now()+interval '1 month' WHERE id=$1").bind(tenant).execute(&p).await.unwrap();
        let staff:Uuid=sqlx::query_scalar("INSERT INTO admin.staff_users(email,display_name,roles) VALUES($1,'Reviewer',ARRAY['student_reviewer']) RETURNING id").bind(format!("{}@staff.test",Uuid::new_v4())).fetch_one(&p).await.unwrap();
        let id:Uuid=sqlx::query_scalar("INSERT INTO student_submissions(tenant_id,applicant_user_id,applicant_name,school,card_expiry_date,file_storage_key,preview_storage_key,mime_type,file_size_bytes,scan_status) VALUES($1,$2,'Ada','University',current_date+365,'id','id','image/png',10,'ready') RETURNING id").bind(tenant).bind(user).fetch_one(&p).await.unwrap();
        let result: Result<String,_>=sqlx::query_scalar("SELECT outcome FROM admin.decide_student_review($1,1,$2,$3,$4,'Unreadable')").bind(id).bind(decision).bind(staff).bind(serde_json::json!({"nameMatches":true,"schoolRecognised":true,"expiryFutureDated":true,"genuineCard":true})).fetch_one(&p).await;
        assert_eq!(result.unwrap(), decision);
        let method: String =
            sqlx::query_scalar("SELECT method FROM student_checks WHERE tenant_id=$1")
                .bind(tenant)
                .fetch_one(&p)
                .await
                .unwrap();
        assert_eq!(method, "id");
        let plan: String = sqlx::query_scalar("SELECT plan FROM tenants WHERE id=$1")
            .bind(tenant)
            .fetch_one(&p)
            .await
            .unwrap();
        assert_eq!(plan, "business");
    }
}
#[tokio::test]
async fn stale_pending_documents_are_scheduled_for_purge() {
    let Some(p) = pool().await else { return };
    let (tenant, user) = fixture(&p).await;
    let id:Uuid=sqlx::query_scalar("INSERT INTO student_submissions(tenant_id,applicant_user_id,applicant_name,school,card_expiry_date,file_storage_key,preview_storage_key,mime_type,file_size_bytes,scan_status,created_at) VALUES($1,$2,'Ada','University',current_date+365,'old-id','old-id','image/png',10,'ready',now()-interval '91 days') RETURNING id").bind(tenant).bind(user).fetch_one(&p).await.unwrap();
    let ids: Vec<Uuid> =
        sqlx::query_scalar("SELECT id FROM admin.student_documents_due_for_purge()")
            .fetch_all(&p)
            .await
            .unwrap();
    assert!(
        ids.contains(&id),
        "pending IDs must not be retained indefinitely"
    );
}
