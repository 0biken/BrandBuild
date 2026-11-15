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
use brandbuild_backend::{api, db, storage::Storage, AppState};
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
    "post_activity",
    "media_assets",
    "notifications",
    "notification_prefs",
    "brand_facts",
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
    api::router(AppState {
        pool: pool.clone(),
        storage: Storage::local(std::env::temp_dir().join("brandbuild-test-media")).unwrap(),
    })
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

// ------------------------------------------------------------ Phase 4: content

/// Adds another member to an existing workspace.
async fn member(owner: &PgPool, tenant: Uuid, role: &str, name: &str) -> Uuid {
    let user = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO users(id,email,display_name,email_verified_at) VALUES($1,$2,$3,now())",
    )
    .bind(user)
    .bind(format!("{user}@example.test"))
    .bind(name)
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
    user
}

/// Uploads `bytes` as a multipart file and returns the status and JSON body.
async fn upload(
    router: Router,
    who: (Uuid, Uuid),
    name: &str,
    bytes: &[u8],
) -> (StatusCode, Value) {
    let boundary = "----brandbuildtest";
    let mut body = format!(
        "--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{name}\"\r\nContent-Type: application/octet-stream\r\n\r\n"
    )
    .into_bytes();
    body.extend_from_slice(bytes);
    body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
    let request = Request::post("/v1/media")
        .header("x-dev-tenant-id", who.0.to_string())
        .header("x-dev-actor-id", who.1.to_string())
        .header(
            header::CONTENT_TYPE,
            format!("multipart/form-data; boundary={boundary}"),
        )
        .body(Body::from(body))
        .unwrap();
    let response = router.oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 64 * 1024).await.unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

const PNG: &[u8] = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR-not-a-real-image-but-the-right-start";

#[tokio::test]
async fn brand_is_saved_per_workspace() {
    let Some(p) = pools().await else { return };
    let a = Some(workspace(&p.owner, "owner").await);
    let b = Some(workspace(&p.owner, "owner").await);

    let (status, body) = call(app(&p.app), "GET", "/v1/brand", a, None).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["data"]["name"], "");
    assert_eq!(body["data"]["plan"], "creator");
    assert_eq!(body["data"]["tones"], json!([]));

    let (status, _) = call(
        app(&p.app),
        "PUT",
        "/v1/brand",
        a,
        Some(json!({"name":"Nova","tones":[],"color":"#0F2A1B"})),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

    let profile = json!({
        "name":"Nova Studio","sells":"Lip gloss","audience":["Students"],"tones":["Warm","Playful"],
        "wordsUse":["glow"],"wordsAvoid":["cheap"],"color":"#0F2A1B","samples":""
    });
    let (status, body) = call(app(&p.app), "PUT", "/v1/brand", a, Some(profile)).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["data"]["voice"], "warm, playful");

    let (_, body) = call(app(&p.app), "GET", "/v1/brand", a, None).await;
    assert_eq!(body["data"]["name"], "Nova Studio");
    assert_eq!(body["data"]["wordsAvoid"], json!(["cheap"]));
    let (_, body) = call(app(&p.app), "GET", "/v1/brand", b, None).await;
    assert_eq!(body["data"]["name"], "", "workspace B sees A's brand");
}

#[tokio::test]
async fn drafts_keep_history_and_can_be_restored() {
    let Some(p) = pools().await else { return };
    let (tenant, user) = workspace(&p.owner, "editor").await;
    let who = Some((tenant, user));

    let (status, first) = call(
        app(&p.app),
        "POST",
        "/v1/drafts",
        who,
        Some(json!({"title":"First","body":"Hello","state":"idea","platforms":["ig"]})),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{first}");
    let first_id = first["data"]["id"].as_str().unwrap().to_owned();
    let (_, second) = call(
        app(&p.app),
        "POST",
        "/v1/drafts",
        who,
        Some(json!({"title":"Second","body":"Newer"})),
    )
    .await;
    let second_id = second["data"]["id"].as_str().unwrap().to_owned();

    let (status, _) = call(
        app(&p.app),
        "POST",
        "/v1/drafts",
        who,
        Some(json!({"title":"Bad","platforms":["myspace"]})),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

    let (status, body) = call(
        app(&p.app),
        "PATCH",
        &format!("/v1/drafts/{first_id}"),
        who,
        Some(json!({"body":"Hello again","state":"ready"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["data"]["body"], "Hello again");
    assert_eq!(body["data"]["state"], "ready");
    assert_eq!(body["data"]["title"], "First");
    let versions: i64 = sqlx::query_scalar("SELECT count(*) FROM post_versions WHERE post_id=$1")
        .bind(Uuid::parse_str(&first_id).unwrap())
        .fetch_one(&p.owner)
        .await
        .unwrap();
    assert_eq!(versions, 2, "an edit must add a version, not overwrite one");

    // Newest first: Second is at 0, First at 1.
    let (_, list) = call(app(&p.app), "GET", "/v1/drafts", who, None).await;
    assert_eq!(list["data"][0]["id"], second_id.as_str());
    let (status, body) = call(
        app(&p.app),
        "DELETE",
        &format!("/v1/drafts/{first_id}"),
        who,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["data"]["index"], 1);
    let (_, list) = call(app(&p.app), "GET", "/v1/drafts", who, None).await;
    assert_eq!(list["data"].as_array().unwrap().len(), 1);
    let (status, _) = call(
        app(&p.app),
        "GET",
        &format!("/v1/drafts/{first_id}"),
        who,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    let (status, _) = call(
        app(&p.app),
        "POST",
        &format!("/v1/drafts/{first_id}/restore"),
        who,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (_, list) = call(app(&p.app), "GET", "/v1/drafts", who, None).await;
    assert_eq!(list["data"][1]["id"], first_id.as_str());

    // Another workspace can't read it.
    let other = Some(workspace(&p.owner, "owner").await);
    let (status, _) = call(
        app(&p.app),
        "GET",
        &format!("/v1/drafts/{first_id}"),
        other,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn posts_follow_roles_and_notify_reviewers() {
    let Some(p) = pools().await else { return };
    let (tenant, owner) = workspace(&p.owner, "owner").await;
    let editor = member(&p.owner, tenant, "editor", "Tobi").await;
    let as_owner = Some((tenant, owner));
    let as_editor = Some((tenant, editor));
    let input = |intent: &str| {
        json!({
            "title":"Weekend drop","caption":"New shades","hashtags":["#glow"],"platforms":["ig","fb"],
            "scheduledAt":"2030-01-05T18:00:00Z","intent":intent
        })
    };

    // An editor can't schedule or publish, only ask for approval.
    for intent in ["schedule", "publish"] {
        let (status, _) = call(
            app(&p.app),
            "POST",
            "/v1/posts",
            as_editor,
            Some(input(intent)),
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{intent}");
    }
    let (status, body) = call(
        app(&p.app),
        "POST",
        "/v1/posts",
        as_editor,
        Some(input("approval")),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    assert_eq!(body["data"]["state"], "approval");
    assert_eq!(body["data"]["requestedBy"]["name"], "Tobi");
    assert_eq!(body["data"]["activity"][0]["text"], "Sent for approval");
    let review_id = body["data"]["id"].as_str().unwrap().to_owned();

    // The owner is told; the editor who sent it is not.
    let (_, notes) = call(app(&p.app), "GET", "/v1/notifications", as_owner, None).await;
    assert_eq!(notes["data"].as_array().unwrap().len(), 1, "{notes}");
    assert_eq!(notes["data"][0]["kind"], "approval");
    assert_eq!(notes["data"][0]["read"], false);
    assert_eq!(
        notes["data"][0]["href"],
        format!("/app/approvals?post={review_id}")
    );
    let (_, own) = call(app(&p.app), "GET", "/v1/notifications", as_editor, None).await;
    assert_eq!(own["data"], json!([]));
    let note_id = notes["data"][0]["id"].as_str().unwrap();
    let (status, body) = call(
        app(&p.app),
        "POST",
        &format!("/v1/notifications/{note_id}/read"),
        as_owner,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["data"]["read"], true);
    // Nobody else can mark it.
    let (status, _) = call(
        app(&p.app),
        "POST",
        &format!("/v1/notifications/{note_id}/read"),
        as_editor,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = call(
        app(&p.app),
        "POST",
        "/v1/notifications/read-all",
        as_owner,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    // The owner schedules directly: allowed, but only under an approval recorded for
    // that exact version.
    let (status, body) = call(
        app(&p.app),
        "POST",
        "/v1/posts",
        as_owner,
        Some(input("schedule")),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    assert_eq!(body["data"]["state"], "scheduled");
    assert_eq!(body["data"]["hashtags"], json!(["#glow"]));
    let id = body["data"]["id"].as_str().unwrap().to_owned();
    assert_eq!(approved_versions(&p.owner, &id).await, 1);
    let mut missing_time = input("schedule");
    missing_time.as_object_mut().unwrap().remove("scheduledAt");
    let (status, _) = call(
        app(&p.app),
        "POST",
        "/v1/posts",
        as_owner,
        Some(missing_time),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

    // The editor can't move or delete the owner's scheduled post.
    let move_to = Some(json!({"scheduledAt":"2030-02-01T09:00:00Z"}));
    let (status, _) = call(
        app(&p.app),
        "POST",
        &format!("/v1/posts/{id}/schedule"),
        as_editor,
        move_to.clone(),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = call(
        app(&p.app),
        "DELETE",
        &format!("/v1/posts/{id}"),
        as_editor,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, body) = call(
        app(&p.app),
        "POST",
        &format!("/v1/posts/{id}/schedule"),
        as_owner,
        move_to,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["data"]["scheduledAt"], "2030-02-01T09:00:00+00:00");

    // Editing adds a version, which needs (and here gets) its own approval.
    let mut edited = input("schedule");
    edited["caption"] = json!("New shades, restocked");
    let (status, body) = call(
        app(&p.app),
        "PUT",
        &format!("/v1/posts/{id}"),
        as_owner,
        Some(edited),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["data"]["caption"], "New shades, restocked");
    assert_eq!(body["data"]["state"], "scheduled");
    assert_eq!(body["data"]["activity"][0]["text"], "Scheduled");
    assert_eq!(body["data"]["activity"][1]["text"], "Edited");
    assert_eq!(approved_versions(&p.owner, &id).await, 2);
    let (_, list) = call(app(&p.app), "GET", "/v1/posts", as_owner, None).await;
    assert_eq!(list["data"].as_array().unwrap().len(), 2);

    // Duplicate makes a draft; delete removes the post from the list.
    let (status, body) = call(
        app(&p.app),
        "POST",
        &format!("/v1/posts/{id}/duplicate"),
        as_owner,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["data"]["title"], "Weekend drop (copy)");
    assert_eq!(body["data"]["body"], "New shades, restocked");
    let (status, _) = call(
        app(&p.app),
        "DELETE",
        &format!("/v1/posts/{id}"),
        as_owner,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (status, _) = call(
        app(&p.app),
        "GET",
        &format!("/v1/posts/{id}"),
        as_owner,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    // Another workspace sees none of this.
    let other = Some(workspace(&p.owner, "owner").await);
    let (_, list) = call(app(&p.app), "GET", "/v1/posts", other, None).await;
    assert_eq!(list["data"], json!([]));
    let (status, _) = call(
        app(&p.app),
        "GET",
        &format!("/v1/posts/{review_id}"),
        other,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn brand_facts_need_verifying_and_stay_in_their_workspace() {
    let Some(p) = pools().await else { return };
    let (tenant, owner) = workspace(&p.owner, "owner").await;
    let editor = member(&p.owner, tenant, "editor", "Tobi").await;
    let as_owner = Some((tenant, owner));
    let as_editor = Some((tenant, editor));

    let (status, body) = post_call(
        &p,
        "/v1/brand/facts",
        as_editor,
        Some(json!({"kind":"offer","label":"Weekend deal","value":"20% off lip gloss","price":"4,500.00","currency":"NGN"})),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    assert_eq!(body["data"]["status"], "unverified");
    assert_eq!(body["data"]["price"], "4500.00");
    let id = body["data"]["id"].as_str().unwrap().to_owned();
    for bad in [
        json!({"kind":"rumour","label":"x","value":"y"}),
        json!({"kind":"offer","label":"","value":"y"}),
        json!({"kind":"offer","label":"x","value":"y","price":"-1"}),
        json!({"kind":"offer","label":"x","value":"y","surprise":true}),
    ] {
        let (status, _) = post_call(&p, "/v1/brand/facts", as_owner, Some(bad.clone())).await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{bad}");
    }

    // Only an owner or reviewer verifies; editing afterwards needs a new check.
    let verify = format!("/v1/brand/facts/{id}/verify");
    let (status, _) = post_call(&p, &verify, as_editor, None).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, body) = post_call(&p, &verify, as_owner, None).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["data"]["status"], "verified");
    let (status, body) = call(
        app(&p.app),
        "PATCH",
        &format!("/v1/brand/facts/{id}"),
        as_editor,
        Some(json!({"value":"30% off lip gloss"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["data"]["status"], "unverified");
    assert_eq!(body["data"]["price"], "4500.00");

    // A fact past its end date is expired and can't be verified.
    let (_, body) = post_call(
        &p,
        "/v1/brand/facts",
        as_owner,
        Some(json!({"kind":"offer","label":"Old","value":"Gone","endsAt":"2020-01-01T00:00:00Z"})),
    )
    .await;
    assert_eq!(body["data"]["status"], "expired");
    let old = body["data"]["id"].as_str().unwrap().to_owned();
    let (status, _) = post_call(&p, &format!("/v1/brand/facts/{old}/verify"), as_owner, None).await;
    assert_eq!(status, StatusCode::CONFLICT);

    // Another workspace can't see, change or verify it.
    let other = Some(workspace(&p.owner, "owner").await);
    let (_, list) = call(app(&p.app), "GET", "/v1/brand/facts", other, None).await;
    assert_eq!(list["data"], json!([]));
    let (status, _) = post_call(&p, &verify, other, None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = call(
        app(&p.app),
        "DELETE",
        &format!("/v1/brand/facts/{id}"),
        other,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = call(
        app(&p.app),
        "DELETE",
        &format!("/v1/brand/facts/{id}"),
        as_owner,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (_, list) = call(app(&p.app), "GET", "/v1/brand/facts", as_owner, None).await;
    assert_eq!(list["data"].as_array().unwrap().len(), 1);
}

/// How many of a post's versions carry an approval with a matching content hash.
async fn approved_versions(owner: &PgPool, post: &str) -> i64 {
    sqlx::query_scalar(
        "SELECT count(DISTINCT v.id) FROM approvals a
         JOIN post_versions v ON v.id=a.post_version_id
         WHERE a.post_id=$1 AND a.decision='approved' AND a.content_hash=v.content_hash",
    )
    .bind(Uuid::parse_str(post).unwrap())
    .fetch_one(owner)
    .await
    .unwrap()
}

async fn db_state(owner: &PgPool, post: &str) -> String {
    sqlx::query_scalar("SELECT state::text FROM posts WHERE id=$1")
        .bind(Uuid::parse_str(post).unwrap())
        .fetch_one(owner)
        .await
        .unwrap()
}

fn post_input(intent: &str, caption: &str) -> Value {
    json!({
        "title":"Weekend drop","caption":caption,"hashtags":["#glow"],"platforms":["ig"],
        "scheduledAt":"2030-01-05T18:00:00Z","intent":intent
    })
}

async fn post_call(
    p: &Pools,
    path: &str,
    who: Option<(Uuid, Uuid)>,
    body: Option<Value>,
) -> (StatusCode, Value) {
    call(app(&p.app), "POST", path, who, body).await
}

#[tokio::test]
async fn no_version_is_scheduled_or_published_without_its_own_approval() {
    let Some(p) = pools().await else { return };
    let (tenant, owner) = workspace(&p.owner, "owner").await;
    let editor = member(&p.owner, tenant, "editor", "Tobi").await;
    let other_editor = member(&p.owner, tenant, "editor", "Ada").await;
    let as_owner = Some((tenant, owner));
    let as_editor = Some((tenant, editor));

    // An approved, scheduled post that is edited and sent for approval leaves the schedule.
    let (_, body) = post_call(
        &p,
        "/v1/posts",
        as_owner,
        Some(post_input("schedule", "One")),
    )
    .await;
    let id = body["data"]["id"].as_str().unwrap().to_owned();
    assert_eq!(db_state(&p.owner, &id).await, "scheduled");
    let (status, body) = call(
        app(&p.app),
        "PUT",
        &format!("/v1/posts/{id}"),
        as_owner,
        Some(post_input("approval", "Two")),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["data"]["state"], "approval");
    assert_eq!(db_state(&p.owner, &id).await, "in_review");
    // The old approval does not cover the new words, so nothing can go out.
    let publish = format!("/v1/posts/{id}/publish");
    let (status, _) = post_call(&p, &publish, as_owner, None).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(approved_versions(&p.owner, &id).await, 1);

    // Even if a row is forced to `scheduled` behind the API's back, publish refuses it.
    sqlx::query("UPDATE posts SET state='scheduled' WHERE id=$1")
        .bind(Uuid::parse_str(&id).unwrap())
        .execute(&p.owner)
        .await
        .unwrap();
    let (status, _) = post_call(&p, &publish, as_owner, None).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(db_state(&p.owner, &id).await, "scheduled");

    // An editor can't edit someone else's post.
    let (status, _) = call(
        app(&p.app),
        "PUT",
        &format!("/v1/posts/{id}"),
        as_editor,
        Some(post_input("approval", "Hijacked")),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (_, body) = post_call(
        &p,
        "/v1/posts",
        as_editor,
        Some(post_input("approval", "Mine")),
    )
    .await;
    let mine = body["data"]["id"].as_str().unwrap().to_owned();
    let (status, _) = call(
        app(&p.app),
        "PUT",
        &format!("/v1/posts/{mine}"),
        Some((tenant, other_editor)),
        Some(post_input("approval", "Not yours")),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    // Approve schedules it under a recorded approval; publish then works, once.
    let (status, body) = post_call(&p, &format!("/v1/posts/{mine}/approve"), as_owner, None).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["data"]["decision"], "approve");
    assert_eq!(body["data"]["post"]["state"], "scheduled");
    assert_eq!(approved_versions(&p.owner, &mine).await, 1);
    let publish = format!("/v1/posts/{mine}/publish");
    let (status, first) = post_call(&p, &publish, as_owner, None).await;
    assert_eq!(status, StatusCode::OK, "{first}");
    let (status, again) = post_call(&p, &publish, as_owner, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(first["data"]["id"], again["data"]["id"]);
    // A post that is going out can't be edited.
    let (status, _) = call(
        app(&p.app),
        "PUT",
        &format!("/v1/posts/{mine}"),
        as_owner,
        Some(post_input("schedule", "Too late")),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    let audited: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM audit_log WHERE resource_id=$1 AND action IN ('post_created','post_approved','publish_requested')",
    )
    .bind(Uuid::parse_str(&mine).unwrap())
    .fetch_one(&p.owner)
    .await
    .unwrap();
    assert_eq!(audited, 3);
}

#[tokio::test]
async fn a_second_approver_can_be_required() {
    let Some(p) = pools().await else { return };
    let (tenant, owner) = workspace(&p.owner, "owner").await;
    let reviewer = member(&p.owner, tenant, "reviewer", "Rita").await;
    let as_owner = Some((tenant, owner));
    let as_reviewer = Some((tenant, reviewer));
    sqlx::query("UPDATE tenants SET require_second_approver=true WHERE id=$1")
        .bind(tenant)
        .execute(&p.owner)
        .await
        .unwrap();

    // The owner's "schedule" now waits for someone else.
    let (status, body) = post_call(
        &p,
        "/v1/posts",
        as_owner,
        Some(post_input("schedule", "One")),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    assert_eq!(body["data"]["state"], "approval");
    let id = body["data"]["id"].as_str().unwrap().to_owned();
    assert_eq!(approved_versions(&p.owner, &id).await, 0);
    let approve = format!("/v1/posts/{id}/approve");
    let (status, _) = post_call(&p, &approve, as_owner, None).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, body) = post_call(&p, &approve, as_reviewer, None).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(db_state(&p.owner, &id).await, "scheduled");

    // Moving an approved post needs a new approval.
    let (status, body) = post_call(
        &p,
        &format!("/v1/posts/{id}/schedule"),
        as_owner,
        Some(json!({"scheduledAt":"2030-03-01T09:00:00Z"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["data"]["state"], "approval");

    // Only an owner changes the rule, and the timezone must be a real one.
    let (status, _) = call(
        app(&p.app),
        "PATCH",
        "/v1/settings/workspace",
        as_reviewer,
        Some(json!({"requireSecondApprover":false})),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = call(
        app(&p.app),
        "PATCH",
        "/v1/settings/workspace",
        as_owner,
        Some(json!({"timezone":"Mars/Olympus"})),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    let (status, body) = call(
        app(&p.app),
        "PATCH",
        "/v1/settings/workspace",
        as_owner,
        Some(json!({"timezone":"Africa/Lagos"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["data"]["timezone"], "Africa/Lagos");
    assert_eq!(body["data"]["requireSecondApprover"], true);
    let (_, versions) = call(
        app(&p.app),
        "GET",
        &format!("/v1/posts/{id}/versions"),
        as_reviewer,
        None,
    )
    .await;
    assert_eq!(versions["data"][0]["version"], 1);
    assert_eq!(versions["data"][0]["decision"], "approved");
    assert_eq!(
        versions["data"][0]["contentHash"].as_str().unwrap().len(),
        64
    );

    // An approval the author gave before the rule was switched on no longer counts.
    let (tenant2, owner2) = workspace(&p.owner, "owner").await;
    let who = Some((tenant2, owner2));
    let (_, body) = post_call(&p, "/v1/posts", who, Some(post_input("schedule", "Solo"))).await;
    let solo = body["data"]["id"].as_str().unwrap().to_owned();
    sqlx::query("UPDATE tenants SET require_second_approver=true WHERE id=$1")
        .bind(tenant2)
        .execute(&p.owner)
        .await
        .unwrap();
    let (status, _) = post_call(&p, &format!("/v1/posts/{solo}/publish"), who, None).await;
    assert_eq!(status, StatusCode::CONFLICT);
}

#[tokio::test]
async fn decisions_send_back_reject_undo_and_withdraw() {
    let Some(p) = pools().await else { return };
    let (tenant, owner) = workspace(&p.owner, "owner").await;
    let editor = member(&p.owner, tenant, "editor", "Tobi").await;
    let as_owner = Some((tenant, owner));
    let as_editor = Some((tenant, editor));

    let (_, body) = post_call(
        &p,
        "/v1/posts",
        as_editor,
        Some(post_input("approval", "Hi")),
    )
    .await;
    let id = body["data"]["id"].as_str().unwrap().to_owned();
    let (status, list) = call(app(&p.app), "GET", "/v1/approvals", as_owner, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(list["data"].as_array().unwrap().len(), 1);
    assert_eq!(list["data"][0]["id"], id.as_str());

    // Changes requested: the post becomes a draft carrying the note. Editors can't decide.
    let note = Some(json!({"note":"Add the price"}));
    let path = format!("/v1/posts/{id}/request-changes");
    let (status, _) = post_call(&p, &path, as_editor, note.clone()).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = post_call(&p, &path, as_owner, Some(json!({"note":"  "}))).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    let (status, body) = post_call(&p, &path, as_owner, note).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["data"]["decision"], "changes");
    assert_eq!(body["data"]["draftId"], id.as_str());
    let (_, draft) = call(
        app(&p.app),
        "GET",
        &format!("/v1/drafts/{id}"),
        as_editor,
        None,
    )
    .await;
    assert_eq!(draft["data"]["feedback"], "Add the price");
    assert_eq!(draft["data"]["body"], "Hi");

    // Undo puts it back to waiting; a second undo has nothing to reverse.
    let undo = format!("/v1/posts/{id}/undo-decision");
    let (status, body) = post_call(&p, &undo, as_owner, None).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["data"]["state"], "approval");
    let (status, _) = post_call(&p, &undo, as_owner, None).await;
    assert_eq!(status, StatusCode::CONFLICT);

    // Reject sends it to Drafts.
    let (status, body) = post_call(&p, &format!("/v1/posts/{id}/reject"), as_owner, None).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["data"]["decision"], "reject");
    assert_eq!(db_state(&p.owner, &id).await, "draft");

    // Undoing an approval unschedules the post, and it can't go out.
    let (_, body) = post_call(
        &p,
        "/v1/posts",
        as_editor,
        Some(post_input("approval", "Hi")),
    )
    .await;
    let second = body["data"]["id"].as_str().unwrap().to_owned();
    post_call(&p, &format!("/v1/posts/{second}/approve"), as_owner, None).await;
    assert_eq!(db_state(&p.owner, &second).await, "scheduled");
    let (status, _) = post_call(
        &p,
        &format!("/v1/posts/{second}/undo-decision"),
        as_owner,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(db_state(&p.owner, &second).await, "in_review");
    let (status, _) = post_call(&p, &format!("/v1/posts/{second}/publish"), as_owner, None).await;
    assert_eq!(status, StatusCode::CONFLICT);

    // The sender can withdraw; it is a draft again and no longer in the inbox.
    let (status, body) =
        post_call(&p, &format!("/v1/posts/{second}/withdraw"), as_editor, None).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["data"]["id"], second.as_str());
    let (_, list) = call(app(&p.app), "GET", "/v1/approvals", as_owner, None).await;
    assert_eq!(list["data"], json!([]));

    // Retry is only for failed posts.
    let (status, _) = post_call(&p, &format!("/v1/posts/{second}/retry"), as_owner, None).await;
    assert_eq!(status, StatusCode::CONFLICT);
}

#[tokio::test]
async fn media_is_checked_stored_and_private() {
    let Some(p) = pools().await else { return };
    let a = workspace(&p.owner, "owner").await;
    let b = workspace(&p.owner, "owner").await;

    // A script renamed to .png is refused: the type comes from the bytes.
    let (status, _) = upload(app(&p.app), a, "photo.png", b"<script>alert(1)</script>").await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

    let (status, body) = upload(app(&p.app), a, "gloss.png", PNG).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    assert_eq!(body["data"]["kind"], "image");
    assert_eq!(body["data"]["type"], "image/png");
    assert_eq!(body["data"]["size"], PNG.len());
    assert_eq!(body["data"]["name"], "gloss.png");
    let id = body["data"]["id"].as_str().unwrap().to_owned();

    // The owner gets the same bytes back; another workspace gets nothing.
    let fetch = |who: (Uuid, Uuid)| {
        let request = Request::get(format!("/v1/media/{id}/file"))
            .header("x-dev-tenant-id", who.0.to_string())
            .header("x-dev-actor-id", who.1.to_string())
            .body(Body::empty())
            .unwrap();
        app(&p.app).oneshot(request)
    };
    let response = fetch(a).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()[header::CONTENT_TYPE], "image/png");
    assert_eq!(
        &to_bytes(response.into_body(), 64 * 1024).await.unwrap()[..],
        PNG
    );
    assert_eq!(fetch(b).await.unwrap().status(), StatusCode::NOT_FOUND);
    let (_, list) = call(app(&p.app), "GET", "/v1/media", Some(b), None).await;
    assert_eq!(list["data"], json!([]));

    // A draft can use it; another workspace can't attach it.
    let with_media = json!({"title":"With photo","media":[{"id":id}]});
    let (status, body) = call(
        app(&p.app),
        "POST",
        "/v1/drafts",
        Some(a),
        Some(with_media.clone()),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    assert_eq!(body["data"]["media"][0]["id"], id.as_str());
    let (status, _) = call(app(&p.app), "POST", "/v1/drafts", Some(b), Some(with_media)).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

    // Removing it empties the library but the draft keeps its photo.
    let (status, _) = call(
        app(&p.app),
        "DELETE",
        &format!("/v1/media/{id}"),
        Some(a),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (_, list) = call(app(&p.app), "GET", "/v1/media", Some(a), None).await;
    assert_eq!(list["data"], json!([]));
    let (_, drafts) = call(app(&p.app), "GET", "/v1/drafts", Some(a), None).await;
    assert_eq!(drafts["data"][0]["media"][0]["id"], id.as_str());
}

#[tokio::test]
async fn notification_settings_and_home_calls_work() {
    let Some(p) = pools().await else { return };
    let who = Some(workspace(&p.owner, "owner").await);
    let (status, body) = call(app(&p.app), "GET", "/v1/settings/notifications", who, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body["data"],
        json!({"postReminders":true,"scheduledAlerts":true,"weeklyInsights":true})
    );
    let (status, body) = call(
        app(&p.app),
        "PATCH",
        "/v1/settings/notifications",
        who,
        Some(json!({"weeklyInsights":false})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        body["data"],
        json!({"postReminders":true,"scheduledAlerts":true,"weeklyInsights":false})
    );

    let (status, body) = call(app(&p.app), "GET", "/v1/platforms", who, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["data"].as_array().unwrap().len(), 4);
    let (status, body) = call(app(&p.app), "GET", "/v1/accounts", who, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["data"], json!([]));
    let (status, body) = call(app(&p.app), "GET", "/v1/analytics/home", who, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["data"].as_array().unwrap().len(), 4);
    // Numbers we don't have are missing, not zero.
    assert_eq!(body["data"][0]["value"], Value::Null);
}
