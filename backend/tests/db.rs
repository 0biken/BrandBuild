//! Database tests: tenant isolation, roles, signup rollback, student check and onboarding.
//!
//! They need Postgres and are skipped unless both URLs are set:
//!   TEST_DATABASE_URL      schema owner (runs migrations, seeds fixtures; bypasses RLS)
//!   TEST_APP_DATABASE_URL  the `brandbuild_app` role the API uses (RLS applies)
//! With `docker compose up -d postgres`:
//!   TEST_DATABASE_URL=postgres://brandbuild:brandbuild@localhost:5432/brandbuild
//!   TEST_APP_DATABASE_URL=postgres://brandbuild_app:brandbuild_app@localhost:5432/brandbuild
use argon2::{
    password_hash::{rand_core::OsRng, PasswordHasher, SaltString},
    Argon2,
};
use axum::{
    body::{to_bytes, Body},
    http::{header, Request, StatusCode},
    Router,
};
use brandbuild_backend::{api, db, AppState};
use serde_json::{json, Value};
use sqlx::{postgres::PgPoolOptions, PgPool};
use tower::ServiceExt;
use uuid::Uuid;

/// Every table holding workspace data. Each must have forced row-level security.
const RLS_TABLES: &[&str] = &[
    "brand_profiles",
    "content_pillars",
    "channels",
    "oauth_states",
    "calendar_plans",
    "calendar_slots",
    "posts",
    "post_versions",
    "approvals",
    "publish_attempts",
    "metric_snapshots",
    "usage_caps",
    "audit_log",
    "student_checks",
    "onboarding_steps",
];
/// Tables with a tenant_id that are deliberately left without RLS (see migration 0005).
const NO_RLS_TABLES: &[&str] = &["tenant_memberships", "outbox", "agent_runs"];

struct Pools {
    owner: PgPool,
    app: PgPool,
}

async fn pools() -> Option<Pools> {
    let (Ok(owner_url), Ok(app_url)) = (
        std::env::var("TEST_DATABASE_URL"),
        std::env::var("TEST_APP_DATABASE_URL"),
    ) else {
        eprintln!("skipped: set TEST_DATABASE_URL and TEST_APP_DATABASE_URL to run database tests");
        return None;
    };
    // Same values in every test, so concurrent tests can't disagree.
    std::env::set_var("ALLOW_DEV_AUTH", "true");
    std::env::set_var("JWT_SECRET", "0123456789abcdef0123456789abcdef");
    std::env::remove_var("SMTP_HOST");

    let owner = PgPoolOptions::new()
        .max_connections(2)
        .connect(&owner_url)
        .await
        .unwrap();
    // The app role needs a password to log in; Docker's init script sets one, CI may not.
    let mut conn = owner.acquire().await.unwrap();
    sqlx::query("SELECT pg_advisory_lock(727001)")
        .execute(&mut *conn)
        .await
        .unwrap();
    sqlx::query(
        "DO $$ BEGIN
           IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='brandbuild_app') THEN
             CREATE ROLE brandbuild_app LOGIN PASSWORD 'brandbuild_app';
           ELSE
             ALTER ROLE brandbuild_app LOGIN PASSWORD 'brandbuild_app';
           END IF;
         END $$",
    )
    .execute(&mut *conn)
    .await
    .unwrap();
    db::migrate(&owner).await.unwrap();
    sqlx::query("SELECT pg_advisory_unlock(727001)")
        .execute(&mut *conn)
        .await
        .unwrap();
    drop(conn);
    let app = PgPoolOptions::new()
        .max_connections(4)
        .connect(&app_url)
        .await
        .unwrap();
    Some(Pools { owner, app })
}

/// A workspace with one member of the given role, created as the owner.
async fn workspace(owner: &PgPool, role: &str) -> (Uuid, Uuid) {
    let tenant = Uuid::new_v4();
    let user = Uuid::new_v4();
    sqlx::query("INSERT INTO tenants(id,name,slug) VALUES($1,'Test',$2)")
        .bind(tenant)
        .bind(format!("t-{tenant}"))
        .execute(owner)
        .await
        .unwrap();
    sqlx::query("INSERT INTO users(id,email,email_verified_at) VALUES($1,$2,now())")
        .bind(user)
        .bind(format!("{user}@example.test"))
        .execute(owner)
        .await
        .unwrap();
    sqlx::query("INSERT INTO tenant_memberships(tenant_id,user_id,role) VALUES($1,$2,$3)")
        .bind(tenant)
        .bind(user)
        .bind(role)
        .execute(owner)
        .await
        .unwrap();
    (tenant, user)
}

async fn brand(owner: &PgPool, tenant: Uuid) -> Uuid {
    sqlx::query_scalar("INSERT INTO brand_profiles(tenant_id,name) VALUES($1,'Brand') RETURNING id")
        .bind(tenant)
        .fetch_one(owner)
        .await
        .unwrap()
}

fn app(pool: &PgPool) -> Router {
    api::router(AppState { pool: pool.clone() })
}

async fn call(
    router: Router,
    method: &str,
    path: &str,
    who: Option<(Uuid, Uuid)>,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let mut request = Request::builder().method(method).uri(path);
    if let Some((tenant, user)) = who {
        request = request
            .header("x-dev-tenant-id", tenant.to_string())
            .header("x-dev-actor-id", user.to_string());
    }
    let request = match body {
        Some(body) => request
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(body.to_string())),
        None => request.body(Body::empty()),
    }
    .unwrap();
    let response = router.oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 64 * 1024).await.unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

#[tokio::test]
async fn every_tenant_table_is_isolated_or_listed_as_an_exception() {
    let Some(p) = pools().await else { return };
    let with_tenant: Vec<String> = sqlx::query_scalar(
        "SELECT c.table_name::text FROM information_schema.columns c
         JOIN information_schema.tables t USING (table_schema, table_name)
         WHERE c.table_schema='public' AND c.column_name='tenant_id' AND t.table_type='BASE TABLE'",
    )
    .fetch_all(&p.owner)
    .await
    .unwrap();
    for table in &with_tenant {
        if NO_RLS_TABLES.contains(&table.as_str()) {
            continue;
        }
        assert!(
            RLS_TABLES.contains(&table.as_str()),
            "{table} has tenant_id but no RLS decision: add it to migration 0005 or NO_RLS_TABLES"
        );
    }
    for table in RLS_TABLES {
        let (enabled, forced, policies): (bool, bool, i64) = sqlx::query_as(
            "SELECT c.relrowsecurity, c.relforcerowsecurity,
                    (SELECT count(*) FROM pg_policies p WHERE p.schemaname='public' AND p.tablename=c.relname)
             FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
             WHERE n.nspname='public' AND c.relname=$1",
        )
        .bind(table)
        .fetch_one(&p.owner)
        .await
        .unwrap();
        assert!(enabled && forced, "{table} must enable and force RLS");
        assert!(policies >= 1, "{table} has no policy");
    }
    let bypass: bool = sqlx::query_scalar(
        "SELECT rolbypassrls OR rolsuper FROM pg_roles WHERE rolname=current_user",
    )
    .fetch_one(&p.app)
    .await
    .unwrap();
    assert!(!bypass, "the API's database role must not bypass RLS");
}

#[tokio::test]
async fn workspaces_cannot_see_or_change_each_others_rows() {
    let Some(p) = pools().await else { return };
    let (a, _) = workspace(&p.owner, "owner").await;
    let (b, _) = workspace(&p.owner, "owner").await;
    let brand_a = brand(&p.owner, a).await;
    let brand_b = brand(&p.owner, b).await;
    for (tenant, brand) in [(a, brand_a), (b, brand_b)] {
        sqlx::query(
            "INSERT INTO content_pillars(tenant_id,brand_profile_id,name) VALUES($1,$2,'P')",
        )
        .bind(tenant)
        .bind(brand)
        .execute(&p.owner)
        .await
        .unwrap();
        sqlx::query("INSERT INTO channels(tenant_id,provider) VALUES($1,'instagram')")
            .bind(tenant)
            .execute(&p.owner)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO audit_log(tenant_id,action,resource_type) VALUES($1,'test','test')",
        )
        .bind(tenant)
        .execute(&p.owner)
        .await
        .unwrap();
        sqlx::query("INSERT INTO student_checks(tenant_id,status) VALUES($1,'none')")
            .bind(tenant)
            .execute(&p.owner)
            .await
            .unwrap();
    }

    for table in [
        "brand_profiles",
        "content_pillars",
        "channels",
        "audit_log",
        "student_checks",
    ] {
        let mut tx = db::tenant_tx(&p.app, a).await.unwrap();
        let foreign: i64 = sqlx::query_scalar(&format!(
            "SELECT count(*) FROM {table} WHERE tenant_id <> $1"
        ))
        .bind(a)
        .fetch_one(&mut *tx)
        .await
        .unwrap();
        let own: i64 = sqlx::query_scalar(&format!(
            "SELECT count(*) FROM {table} WHERE tenant_id = $1"
        ))
        .bind(a)
        .fetch_one(&mut *tx)
        .await
        .unwrap();
        assert_eq!(foreign, 0, "{table}: workspace A sees other rows");
        assert_eq!(own, 1, "{table}: workspace A can't see its own row");
        if table != "audit_log" {
            let changed = sqlx::query(&format!(
                "UPDATE {table} SET updated_at=now() WHERE tenant_id=$1"
            ))
            .bind(b)
            .execute(&mut *tx)
            .await
            .unwrap()
            .rows_affected();
            assert_eq!(changed, 0, "{table}: workspace A updated B's row");
        }
        let deleted = sqlx::query(&format!("DELETE FROM {table} WHERE tenant_id=$1"))
            .bind(b)
            .execute(&mut *tx)
            .await
            .unwrap()
            .rows_affected();
        assert_eq!(deleted, 0, "{table}: workspace A deleted B's row");
        tx.rollback().await.unwrap();
    }

    // Writing a row for another workspace is refused outright.
    let mut tx = db::tenant_tx(&p.app, a).await.unwrap();
    let err = sqlx::query("INSERT INTO brand_profiles(tenant_id,name) VALUES($1,'Sneaky')")
        .bind(b)
        .execute(&mut *tx)
        .await
        .unwrap_err();
    assert!(err.to_string().contains("row-level security"), "{err}");
}

#[tokio::test]
async fn no_tenant_set_means_no_rows() {
    let Some(p) = pools().await else { return };
    let (a, _) = workspace(&p.owner, "owner").await;
    brand(&p.owner, a).await;
    for table in RLS_TABLES {
        let n: i64 = sqlx::query_scalar(&format!("SELECT count(*) FROM {table}"))
            .fetch_one(&p.app)
            .await
            .unwrap();
        assert_eq!(n, 0, "{table} returned rows with no tenant set");
    }
}

#[tokio::test]
async fn roles_gate_decisions_and_settings() {
    let Some(p) = pools().await else { return };
    let (tenant, editor) = workspace(&p.owner, "editor").await;
    let post = Uuid::new_v4();
    let (status, body) = call(
        app(&p.app),
        "POST",
        &format!("/v1/posts/{post}/approve"),
        Some((tenant, editor)),
        Some(json!({})),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(body["error"]["code"], "forbidden");

    let (status, _) = call(
        app(&p.app),
        "POST",
        "/v1/channels",
        Some((tenant, editor)),
        Some(json!({"provider":"instagram"})),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    // A reviewer may decide, so the same call gets past the role check.
    let (tenant, reviewer) = workspace(&p.owner, "reviewer").await;
    let (status, _) = call(
        app(&p.app),
        "POST",
        &format!("/v1/posts/{post}/approve"),
        Some((tenant, reviewer)),
        Some(json!({})),
    )
    .await;
    assert_ne!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn signup_saves_nothing_when_email_cannot_be_sent() {
    let Some(p) = pools().await else { return };
    let email = format!("{}@example.test", Uuid::new_v4());
    let (status, body) = call(
        app(&p.app),
        "POST",
        "/v1/auth/signup",
        None,
        Some(json!({"name":"Ada","identifier":email,"password":"Testing123"})),
    )
    .await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(body["error"]["code"], "email_unavailable");
    let users: i64 = sqlx::query_scalar("SELECT count(*) FROM users WHERE email=$1")
        .bind(&email)
        .fetch_one(&p.owner)
        .await
        .unwrap();
    assert_eq!(users, 0, "signup kept a user it couldn't email");
}

#[tokio::test]
async fn student_check_sets_the_plan() {
    let Some(p) = pools().await else { return };
    let (tenant, user) = workspace(&p.owner, "owner").await;
    let who = Some((tenant, user));

    // The code email would need SMTP, so seed the state the send step leaves behind.
    sqlx::query("INSERT INTO student_checks(tenant_id,status,method,email) VALUES($1,'code_sent','email','ada@stu.ui.edu.ng')")
        .bind(tenant)
        .execute(&p.owner)
        .await
        .unwrap();
    let hash = Argon2::default()
        .hash_password(b"482913", &SaltString::generate(&mut OsRng))
        .unwrap()
        .to_string();
    sqlx::query("INSERT INTO auth_codes(user_id,purpose,code_hash,expires_at) VALUES($1,'student_email',$2,now()+interval '10 minutes')")
        .bind(user)
        .bind(hash)
        .execute(&p.owner)
        .await
        .unwrap();

    let (status, body) = call(
        app(&p.app),
        "POST",
        "/v1/student-check/code",
        who,
        Some(json!({"email":"ada@gmail.com"})),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");

    let (status, body) = call(
        app(&p.app),
        "POST",
        "/v1/student-check/code/verify",
        who,
        Some(json!({"code":"000000"})),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(body["error"]["code"], "invalid_code");

    let (status, body) = call(
        app(&p.app),
        "POST",
        "/v1/student-check/code/verify",
        who,
        Some(json!({"code":"482913"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["data"]["status"], "verified");
    let plan: String = sqlx::query_scalar("SELECT plan FROM tenants WHERE id=$1")
        .bind(tenant)
        .fetch_one(&p.owner)
        .await
        .unwrap();
    assert_eq!(plan, "student");

    let (status, body) = call(app(&p.app), "POST", "/v1/student-check/skip", who, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["data"]["status"], "not_student");
    let plan: String = sqlx::query_scalar("SELECT plan FROM tenants WHERE id=$1")
        .bind(tenant)
        .fetch_one(&p.owner)
        .await
        .unwrap();
    assert_eq!(plan, "creator");

    let (status, body) = call(app(&p.app), "POST", "/v1/student-check/id", who, None).await;
    assert_eq!(status, StatusCode::NOT_IMPLEMENTED);
    assert_eq!(body["error"]["code"], "not_available");
}

#[tokio::test]
async fn onboarding_steps_persist() {
    let Some(p) = pools().await else { return };
    let (tenant, user) = workspace(&p.owner, "owner").await;
    let who = Some((tenant, user));
    let (status, body) = call(app(&p.app), "GET", "/v1/onboarding", who, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body["data"],
        json!({"verify":"todo","connect":"todo","brand":"todo"})
    );
    let (status, _) = call(
        app(&p.app),
        "POST",
        "/v1/onboarding/verify",
        who,
        Some(json!({"status":"skipped"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    call(
        app(&p.app),
        "POST",
        "/v1/onboarding/connect",
        who,
        Some(json!({"status":"done"})),
    )
    .await;
    let (_, body) = call(app(&p.app), "GET", "/v1/onboarding", who, None).await;
    assert_eq!(
        body["data"],
        json!({"verify":"skipped","connect":"done","brand":"todo"})
    );
    let (status, _) = call(
        app(&p.app),
        "POST",
        "/v1/onboarding/nope",
        who,
        Some(json!({"status":"done"})),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}
