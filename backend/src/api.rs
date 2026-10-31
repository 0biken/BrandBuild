use axum::{
    extract::{Path, Query, Request, State},
    http::StatusCode,
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{PgPool, Row};
use uuid::Uuid;

use crate::{auth::{self, TenantContext}, AppState};

async fn health() -> Json<Value> { Json(json!({"status":"ok"})) }
async fn placeholder() -> Json<Value> { Json(json!({"status":"not_implemented", "note":"route scaffold only"})) }

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ResourceKind { Brand, Channel, Calendar, Post }
impl ResourceKind {
    fn table(self) -> &'static str { match self { Self::Brand=>"brand_profiles", Self::Channel=>"channels", Self::Calendar=>"calendar_plans", Self::Post=>"posts" } }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Resource { pub id: Uuid, pub kind: ResourceKind, pub data: Value, pub created_at: DateTime<Utc>, pub updated_at: DateTime<Utc> }
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct BrandInput { pub name:String, pub website_url:Option<String>, #[serde(default)] pub voice:Value, #[serde(default)] pub audience:Value, pub guidelines:Option<String> }
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct ChannelInput { pub provider:String, pub display_name:Option<String>, pub external_account_id:Option<String>, #[serde(default)] pub metadata:Value }
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct CalendarInput { pub name:String, pub starts_on:chrono::NaiveDate, pub ends_on:chrono::NaiveDate, #[serde(default)] pub settings:Value }
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct PostInput { pub content:Value, pub channel_id:Option<Uuid>, pub scheduled_for:Option<DateTime<Utc>> }
#[derive(Clone, Debug, Serialize)] pub struct ResourceResponse { pub data:Resource }
#[derive(Clone, Debug, Deserialize)] pub struct ListQuery { pub limit:Option<usize> }
#[derive(Clone, Debug, Serialize)] pub struct ListResponse { pub data:Vec<Resource> }
#[derive(Clone, Debug, Serialize)] pub struct AnalyticsResponse { pub data:AnalyticsSummary }
#[derive(Clone, Debug, Serialize)] pub struct AnalyticsSummary { pub brands:i64, pub channels:i64, pub calendars:i64, pub posts:i64 }
#[derive(Clone, Debug, Serialize)] pub struct AuditResponse { pub data:Vec<AuditEntry> }
#[derive(Clone, Debug, Serialize)] pub struct AuditEntry { pub id:Uuid, pub action:String, pub resource_type:String, pub resource_id:Option<Uuid>, pub created_at:DateTime<Utc> }
#[derive(Clone, Debug, Serialize)] pub struct ErrorResponse { pub error:ApiErrorBody }
#[derive(Clone, Debug, Serialize)] pub struct ApiErrorBody { pub code:&'static str, pub message:String }
#[derive(Debug, thiserror::Error)] pub enum ApiError { #[error("resource not found")] NotFound, #[error("request data is invalid")] InvalidInput, #[error("internal server error")] Internal }
impl From<sqlx::Error> for ApiError { fn from(err:sqlx::Error)->Self { tracing::error!(error=?err,"database request failed"); Self::Internal } }
impl IntoResponse for ApiError { fn into_response(self)->Response { let message=self.to_string(); let (status,code)=match self { Self::NotFound=>(StatusCode::NOT_FOUND,"not_found"),Self::InvalidInput=>(StatusCode::UNPROCESSABLE_ENTITY,"invalid_input"),Self::Internal=>(StatusCode::INTERNAL_SERVER_ERROR,"internal_error") }; (status,Json(ErrorResponse{error:ApiErrorBody{code,message}})).into_response() } }

async fn auth_middleware(State(state):State<AppState>, mut request:Request, next:Next)->Response {
    let (mut parts, body)=request.into_parts();
    match auth::resolve_bearer(&parts,&state.pool).await {
        Ok(ctx)=>{ parts.extensions.insert(ctx); request=Request::from_parts(parts,body); next.run(request).await }
        Err(e)=>e.into_response()
    }
}

fn from_row(row:&sqlx::postgres::PgRow, kind:ResourceKind)->Result<Resource,ApiError> {
    let id:Uuid=row.try_get("id").map_err(|_|ApiError::Internal)?;
    let created_at:DateTime<Utc>=row.try_get("created_at").map_err(|_|ApiError::Internal)?;
    let updated_at:DateTime<Utc>=row.try_get("updated_at").unwrap_or(created_at);
    let data=match kind {
        ResourceKind::Brand=>json!({"name":row.try_get::<String,_>("name").map_err(|_|ApiError::Internal)?,"website_url":row.try_get::<Option<String>,_>("website_url").map_err(|_|ApiError::Internal)?,"voice":row.try_get::<Value,_>("voice").map_err(|_|ApiError::Internal)?,"audience":row.try_get::<Value,_>("audience").map_err(|_|ApiError::Internal)?,"guidelines":row.try_get::<Option<String>,_>("guidelines").map_err(|_|ApiError::Internal)?}),
        ResourceKind::Channel=>json!({"provider":row.try_get::<String,_>("provider").map_err(|_|ApiError::Internal)?,"display_name":row.try_get::<Option<String>,_>("display_name").map_err(|_|ApiError::Internal)?,"external_account_id":row.try_get::<Option<String>,_>("external_account_id").map_err(|_|ApiError::Internal)?,"metadata":row.try_get::<Value,_>("metadata").map_err(|_|ApiError::Internal)?}),
        ResourceKind::Calendar=>json!({"name":row.try_get::<String,_>("name").map_err(|_|ApiError::Internal)?,"starts_on":row.try_get::<chrono::NaiveDate,_>("starts_on").map_err(|_|ApiError::Internal)?,"ends_on":row.try_get::<chrono::NaiveDate,_>("ends_on").map_err(|_|ApiError::Internal)?,"settings":row.try_get::<Value,_>("settings").map_err(|_|ApiError::Internal)?}),
        ResourceKind::Post=>json!({"content":row.try_get::<Value,_>("content").map_err(|_|ApiError::Internal)?,"channel_id":row.try_get::<Option<Uuid>,_>("channel_id").map_err(|_|ApiError::Internal)?,"scheduled_for":row.try_get::<Option<DateTime<Utc>>,_>("scheduled_for").map_err(|_|ApiError::Internal)?,"state":row.try_get::<String,_>("state").map_err(|_|ApiError::Internal)?,"version_id":row.try_get::<Uuid,_>("version_id").map_err(|_|ApiError::Internal)?})
    };
    Ok(Resource{id,kind,data,created_at,updated_at})
}
fn select_sql(kind:ResourceKind, by_id:bool)->String {
    let filter=if by_id{if matches!(kind,ResourceKind::Post){" AND p.id=$2"}else{" AND r.id=$2"}}else{""};
    match kind {
      ResourceKind::Brand=>format!("SELECT r.id,r.created_at,r.updated_at,r.name,r.website_url,r.voice,r.audience,r.guidelines FROM brand_profiles r WHERE r.tenant_id=$1{filter}"),
      ResourceKind::Channel=>format!("SELECT r.id,r.created_at,r.updated_at,r.provider,r.display_name,r.external_account_id,r.metadata FROM channels r WHERE r.tenant_id=$1{filter}"),
      ResourceKind::Calendar=>format!("SELECT r.id,r.created_at,r.updated_at,r.name,r.starts_on,r.ends_on,r.settings FROM calendar_plans r WHERE r.tenant_id=$1{filter}"),
      ResourceKind::Post=>format!("SELECT p.id,p.created_at,p.updated_at,p.channel_id,p.scheduled_for,p.state::text AS state,v.id AS version_id,v.content FROM posts p JOIN post_versions v ON v.tenant_id=p.tenant_id AND v.post_id=p.id AND v.version=p.current_version WHERE p.tenant_id=$1{filter}"),
    }
}
async fn query_resource(pool:&PgPool,ctx:&TenantContext,kind:ResourceKind,id:Option<Uuid>,limit:Option<usize>)->Result<Vec<Resource>,ApiError>{
    let mut tx=pool.begin().await?; sqlx::query("SELECT set_config('app.tenant_id',$1,true)").bind(ctx.tenant_id.to_string()).execute(&mut *tx).await?;
    let rows=match (id,limit) {
        (Some(id),Some(n))=>sqlx::query(&format!("{} LIMIT $3",select_sql(kind,true))).bind(ctx.tenant_id).bind(id).bind(n.clamp(1,500) as i64).fetch_all(&mut *tx).await?,
        (Some(id),None)=>sqlx::query(&select_sql(kind,true)).bind(ctx.tenant_id).bind(id).fetch_all(&mut *tx).await?,
        (None,Some(n))=>sqlx::query(&format!("{} LIMIT $2",select_sql(kind,false))).bind(ctx.tenant_id).bind(n.clamp(1,500) as i64).fetch_all(&mut *tx).await?,
        (None,None)=>sqlx::query(&select_sql(kind,false)).bind(ctx.tenant_id).fetch_all(&mut *tx).await?,
    };
    let result=rows.iter().map(|r|from_row(r,kind)).collect::<Result<Vec<_>,_>>()?; tx.commit().await?; Ok(result)
}
async fn create_resource(pool:&PgPool,ctx:&TenantContext,kind:ResourceKind,data:Value)->Result<Resource,ApiError>{
    if !data.is_object(){return Err(ApiError::InvalidInput)}
    let mut tx=pool.begin().await?; sqlx::query("SELECT set_config('app.tenant_id',$1,true)").bind(ctx.tenant_id.to_string()).execute(&mut *tx).await?;
    let id=Uuid::new_v4();
    match kind {
      ResourceKind::Brand=>{sqlx::query("INSERT INTO brand_profiles(id,tenant_id,name,website_url,voice,audience,guidelines) VALUES($1,$2,$3,$4,$5,$6,$7)").bind(id).bind(ctx.tenant_id).bind(data["name"].as_str().ok_or(ApiError::InvalidInput)?).bind(data["website_url"].as_str()).bind(data.get("voice").cloned().unwrap_or(json!({}))).bind(data.get("audience").cloned().unwrap_or(json!({}))).bind(data["guidelines"].as_str()).execute(&mut *tx).await?;},
      ResourceKind::Channel=>{sqlx::query("INSERT INTO channels(id,tenant_id,provider,display_name,external_account_id,metadata) VALUES($1,$2,$3,$4,$5,$6)").bind(id).bind(ctx.tenant_id).bind(data["provider"].as_str().ok_or(ApiError::InvalidInput)?).bind(data["display_name"].as_str()).bind(data["external_account_id"].as_str()).bind(data.get("metadata").cloned().unwrap_or(json!({}))).execute(&mut *tx).await?;},
      ResourceKind::Calendar=>{sqlx::query("INSERT INTO calendar_plans(id,tenant_id,name,starts_on,ends_on,settings) VALUES($1,$2,$3,$4,$5,$6)").bind(id).bind(ctx.tenant_id).bind(data["name"].as_str().ok_or(ApiError::InvalidInput)?).bind(data["starts_on"].as_str().ok_or(ApiError::InvalidInput)?).bind(data["ends_on"].as_str().ok_or(ApiError::InvalidInput)?).bind(data.get("settings").cloned().unwrap_or(json!({}))).execute(&mut *tx).await?;},
      ResourceKind::Post=>{let channel=data["channel_id"].as_str().and_then(|s|Uuid::parse_str(s).ok());let sched=data["scheduled_for"].as_str().map(|s| s.parse::<DateTime<Utc>>().map_err(|_| ApiError::InvalidInput)).transpose()?;sqlx::query("INSERT INTO posts(id,tenant_id,channel_id,scheduled_for,current_version) VALUES($1,$2,$3,$4,1)").bind(id).bind(ctx.tenant_id).bind(channel).bind(sched).execute(&mut *tx).await?;let version_id=Uuid::new_v4();sqlx::query("INSERT INTO post_versions(id,tenant_id,post_id,version,content,created_by) VALUES($1,$2,$3,1,$4,$5)").bind(version_id).bind(ctx.tenant_id).bind(id).bind(data.get("content").cloned().unwrap_or(json!({}))).bind(ctx.actor_id).execute(&mut *tx).await?;}
    }
    tx.commit().await?; query_resource(pool,ctx,kind,Some(id),None).await?.into_iter().next().ok_or(ApiError::NotFound)
}
async fn create_kind(State(state):State<AppState>,ctx:TenantContext,Json(data):Json<Value>,kind:ResourceKind)->Result<(StatusCode,Json<ResourceResponse>),ApiError>{let r=create_resource(&state.pool,&ctx,kind,data).await?;Ok((StatusCode::CREATED,Json(ResourceResponse{data:r})))}
async fn list_kind(State(state):State<AppState>,ctx:TenantContext,Query(q):Query<ListQuery>,kind:ResourceKind)->Result<Json<ListResponse>,ApiError>{Ok(Json(ListResponse{data:query_resource(&state.pool,&ctx,kind,None,q.limit).await?}))}
async fn get_kind(State(state):State<AppState>,ctx:TenantContext,Path(id):Path<Uuid>,kind:ResourceKind)->Result<Json<ResourceResponse>,ApiError>{let r=query_resource(&state.pool,&ctx,kind,Some(id),None).await?.into_iter().next().ok_or(ApiError::NotFound)?;Ok(Json(ResourceResponse{data:r}))}
async fn update_kind(State(state):State<AppState>,ctx:TenantContext,Path(id):Path<Uuid>,Json(data):Json<Value>,kind:ResourceKind)->Result<Json<ResourceResponse>,ApiError>{
 if !data.is_object(){return Err(ApiError::InvalidInput)} let mut tx=state.pool.begin().await?;sqlx::query("SELECT set_config('app.tenant_id',$1,true)").bind(ctx.tenant_id.to_string()).execute(&mut *tx).await?;
 let changed=match kind {
 ResourceKind::Brand=>sqlx::query("UPDATE brand_profiles SET name=$3,website_url=$4,voice=$5,audience=$6,guidelines=$7,updated_at=now() WHERE tenant_id=$1 AND id=$2").bind(ctx.tenant_id).bind(id).bind(data["name"].as_str().ok_or(ApiError::InvalidInput)?).bind(data["website_url"].as_str()).bind(data.get("voice").cloned().unwrap_or(json!({}))).bind(data.get("audience").cloned().unwrap_or(json!({}))).bind(data["guidelines"].as_str()).execute(&mut *tx).await?.rows_affected(),
 ResourceKind::Channel=>sqlx::query("UPDATE channels SET provider=$3,display_name=$4,external_account_id=$5,metadata=$6,updated_at=now() WHERE tenant_id=$1 AND id=$2").bind(ctx.tenant_id).bind(id).bind(data["provider"].as_str().ok_or(ApiError::InvalidInput)?).bind(data["display_name"].as_str()).bind(data["external_account_id"].as_str()).bind(data.get("metadata").cloned().unwrap_or(json!({}))).execute(&mut *tx).await?.rows_affected(),
 ResourceKind::Calendar=>sqlx::query("UPDATE calendar_plans SET name=$3,starts_on=$4,ends_on=$5,settings=$6,updated_at=now() WHERE tenant_id=$1 AND id=$2").bind(ctx.tenant_id).bind(id).bind(data["name"].as_str().ok_or(ApiError::InvalidInput)?).bind(data["starts_on"].as_str().ok_or(ApiError::InvalidInput)?).bind(data["ends_on"].as_str().ok_or(ApiError::InvalidInput)?).bind(data.get("settings").cloned().unwrap_or(json!({}))).execute(&mut *tx).await?.rows_affected(),
 ResourceKind::Post=>{let current=sqlx::query("SELECT current_version FROM posts WHERE tenant_id=$1 AND id=$2 FOR UPDATE").bind(ctx.tenant_id).bind(id).fetch_optional(&mut *tx).await?.ok_or(ApiError::NotFound)?.try_get::<i32,_>("current_version")?;let version=current+1;let vid=Uuid::new_v4();let sched=data["scheduled_for"].as_str().map(|s| s.parse::<DateTime<Utc>>().map_err(|_| ApiError::InvalidInput)).transpose()?;sqlx::query("INSERT INTO post_versions(id,tenant_id,post_id,version,content,created_by) VALUES($1,$2,$3,$4,$5,$6)").bind(vid).bind(ctx.tenant_id).bind(id).bind(version).bind(data.get("content").cloned().unwrap_or(json!({}))).bind(ctx.actor_id).execute(&mut *tx).await?;sqlx::query("UPDATE posts SET current_version=$3,channel_id=$4,scheduled_for=$5,updated_at=now() WHERE tenant_id=$1 AND id=$2").bind(ctx.tenant_id).bind(id).bind(version).bind(data["channel_id"].as_str().and_then(|s|Uuid::parse_str(s).ok())).bind(sched).execute(&mut *tx).await?.rows_affected()}
 };tx.commit().await?;if changed==0{return Err(ApiError::NotFound)}let r=query_resource(&state.pool,&ctx,kind,Some(id),None).await?.into_iter().next().ok_or(ApiError::NotFound)?;Ok(Json(ResourceResponse{data:r}))
}
async fn delete_kind(State(state):State<AppState>,ctx:TenantContext,Path(id):Path<Uuid>,kind:ResourceKind)->Result<StatusCode,ApiError>{let sql=format!("DELETE FROM {} WHERE tenant_id=$1 AND id=$2",kind.table());let n=sqlx::query(&sql).bind(ctx.tenant_id).bind(id).execute(&state.pool).await?.rows_affected();if n==0{return Err(ApiError::NotFound)}Ok(StatusCode::NO_CONTENT)}

async fn analytics(State(s):State<AppState>,ctx:TenantContext)->Result<Json<AnalyticsResponse>,ApiError>{let mut tx=s.pool.begin().await?;sqlx::query("SELECT set_config('app.tenant_id',$1,true)").bind(ctx.tenant_id.to_string()).execute(&mut *tx).await?;let row=sqlx::query("SELECT (SELECT count(*) FROM brand_profiles WHERE tenant_id=$1) brands,(SELECT count(*) FROM channels WHERE tenant_id=$1) channels,(SELECT count(*) FROM calendar_plans WHERE tenant_id=$1) calendars,(SELECT count(*) FROM posts WHERE tenant_id=$1) posts").bind(ctx.tenant_id).fetch_one(&mut *tx).await?;let out=AnalyticsSummary{brands:row.try_get("brands")?,channels:row.try_get("channels")?,calendars:row.try_get("calendars")?,posts:row.try_get("posts")?};tx.commit().await?;Ok(Json(AnalyticsResponse{data:out}))}
async fn audit(State(s):State<AppState>,ctx:TenantContext,Query(q):Query<ListQuery>)->Result<Json<AuditResponse>,ApiError>{let rows=sqlx::query("SELECT id,action,resource_type,resource_id,created_at FROM audit_log WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT $2").bind(ctx.tenant_id).bind(q.limit.unwrap_or(100).clamp(1,500) as i64).fetch_all(&s.pool).await?;let data=rows.iter().map(|r|Ok(AuditEntry{id:r.try_get("id")?,action:r.try_get("action")?,resource_type:r.try_get("resource_type")?,resource_id:r.try_get("resource_id")?,created_at:r.try_get("created_at")?})).collect::<Result<Vec<_>,sqlx::Error>>()?;Ok(Json(AuditResponse{data}))}
#[derive(Deserialize)] struct ApprovalInput{decision:Option<String>,comment:Option<String>}
async fn approve(State(s):State<AppState>,ctx:TenantContext,Path(id):Path<Uuid>,Json(input):Json<ApprovalInput>)->Result<Json<Value>,ApiError>{let mut tx=s.pool.begin().await?;sqlx::query("SELECT set_config('app.tenant_id',$1,true)").bind(ctx.tenant_id.to_string()).execute(&mut *tx).await?;let post=sqlx::query("SELECT current_version,state::text AS state FROM posts WHERE tenant_id=$1 AND id=$2 FOR UPDATE").bind(ctx.tenant_id).bind(id).fetch_optional(&mut *tx).await?.ok_or(ApiError::NotFound)?;let version:i32=post.try_get("current_version")?;if post.try_get::<String,_>("state")?!="in_review"{return Err(ApiError::InvalidInput)}let row=sqlx::query("SELECT id FROM post_versions WHERE tenant_id=$1 AND post_id=$2 AND version=$3").bind(ctx.tenant_id).bind(id).bind(version).fetch_one(&mut *tx).await?;let vid:Uuid=row.try_get("id")?;let decision=input.decision.unwrap_or_else(||"approved".into());if decision!="approved"&&decision!="changes_requested"{return Err(ApiError::InvalidInput)}let approval=Uuid::new_v4();sqlx::query("INSERT INTO approvals(id,tenant_id,post_id,post_version_id,reviewer_id,decision,comment) VALUES($1,$2,$3,$4,$5,$6::approval_decision,$7)").bind(approval).bind(ctx.tenant_id).bind(id).bind(vid).bind(ctx.actor_id).bind(decision.as_str()).bind(input.comment).execute(&mut *tx).await?;sqlx::query("UPDATE posts SET state=$3::post_state,updated_at=now() WHERE tenant_id=$1 AND id=$2").bind(ctx.tenant_id).bind(id).bind(if decision=="approved"{"approved"}else{"changes_requested"}).execute(&mut *tx).await?;tx.commit().await?;Ok(Json(json!({"data":{"id":approval,"post_id":id,"post_version_id":vid,"decision":decision}})))}
async fn publish(State(s):State<AppState>,ctx:TenantContext,Path(id):Path<Uuid>)->Result<Json<Value>,ApiError>{
 let mut tx=s.pool.begin().await?;
 sqlx::query("SELECT set_config('app.tenant_id',$1,true)").bind(ctx.tenant_id.to_string()).execute(&mut *tx).await?;
 let p=sqlx::query("SELECT current_version,channel_id,state::text AS state FROM posts WHERE tenant_id=$1 AND id=$2 FOR UPDATE").bind(ctx.tenant_id).bind(id).fetch_optional(&mut *tx).await?.ok_or(ApiError::NotFound)?;
 let post_state=p.try_get::<String,_>("state")?;
 if post_state!="approved" && post_state!="publishing" { return Err(ApiError::InvalidInput); }
 let version:i32=p.try_get("current_version")?;
 let v=sqlx::query("SELECT id FROM post_versions WHERE tenant_id=$1 AND post_id=$2 AND version=$3").bind(ctx.tenant_id).bind(id).bind(version).fetch_one(&mut *tx).await?;
 let vid:Uuid=v.try_get("id")?;
 let approved=sqlx::query("SELECT EXISTS(SELECT 1 FROM approvals WHERE tenant_id=$1 AND post_id=$2 AND post_version_id=$3 AND decision='approved') AS ok").bind(ctx.tenant_id).bind(id).bind(vid).fetch_one(&mut *tx).await?.try_get::<bool,_>("ok")?;
 if !approved { return Err(ApiError::InvalidInput); }
 let key=format!("publish:{id}:{vid}");
 let attempt=Uuid::new_v4();
 let inserted=sqlx::query("INSERT INTO publish_attempts(id,tenant_id,post_id,post_version_id,channel_id,idempotency_key,state,started_at) VALUES($1,$2,$3,$4,$5,$6,'running',now()) ON CONFLICT(tenant_id,idempotency_key) DO NOTHING RETURNING id").bind(attempt).bind(ctx.tenant_id).bind(id).bind(vid).bind(p.try_get::<Option<Uuid>,_>("channel_id")?).bind(&key).fetch_optional(&mut *tx).await?;
 let attempt_id=if let Some(r)=inserted {
   let aid:Uuid=r.try_get("id")?;
   sqlx::query("INSERT INTO audit_log(tenant_id,actor_id,action,resource_type,resource_id,details) VALUES($1,$2,'publish_requested','post',$3,jsonb_build_object('post_version_id',$4::text,'attempt_id',$5::text))").bind(ctx.tenant_id).bind(ctx.actor_id).bind(id).bind(vid).bind(aid).execute(&mut *tx).await?;
   sqlx::query("UPDATE posts SET state='publishing',updated_at=now() WHERE tenant_id=$1 AND id=$2").bind(ctx.tenant_id).bind(id).execute(&mut *tx).await?;
   aid
 } else {
   sqlx::query("SELECT id FROM publish_attempts WHERE tenant_id=$1 AND idempotency_key=$2 FOR UPDATE").bind(ctx.tenant_id).bind(&key).fetch_one(&mut *tx).await?.try_get("id")?
 };
 tx.commit().await?;
 Ok(Json(json!({"data":{"id":attempt_id,"post_id":id,"post_version_id":vid,"state":"running"}})))
}

pub fn router(state:AppState)->Router{
 let v2=Router::new()
 .route("/brands",get(list_brand).post(create_brand)).route("/brands/:id",get(get_brand).put(update_brand).delete(delete_brand))
 .route("/channels",get(list_channel).post(create_channel)).route("/channels/:id",get(get_channel).put(update_channel).delete(delete_channel))
 .route("/calendars",get(list_calendar).post(create_calendar)).route("/calendars/:id",get(get_calendar).put(update_calendar).delete(delete_calendar))
 .route("/posts",get(list_post).post(create_post)).route("/posts/:id",get(get_post).put(update_post).delete(delete_post))
 .route("/posts/:id/approve",post(approve)).route("/posts/:id/publish",post(publish)).route("/analytics",get(analytics)).route("/audit",get(audit))
 .layer(middleware::from_fn_with_state(state.clone(),auth_middleware)).with_state(state.clone());
 Router::new().route("/health",get(health))
 .route("/v1/brand",get(list_brand).post(create_brand))
 .route("/v1/channels",get(list_channel).post(create_channel)).route("/v1/channels/:channel_id",get(get_channel).put(update_channel).delete(delete_channel))
 .route("/v1/calendar-plans",get(list_calendar).post(create_calendar)).route("/v1/calendar-plans/:plan_id",get(get_calendar).put(update_calendar).delete(delete_calendar))
 .route("/v1/posts",get(list_post).post(create_post)).route("/v1/posts/:post_id",get(get_post).put(update_post).delete(delete_post))
 .route("/v1/posts/:post_id/approve",post(approve)).route("/v1/posts/:post_id/publish",post(publish))
 .route("/v1/analytics",get(analytics)).route("/v1/audit",get(audit))
 .nest("/v2",v2).with_state(state)
}

macro_rules! resource_handlers { ($list:ident,$create:ident,$get:ident,$update:ident,$delete:ident,$kind:ident,$input:ty)=>{
 async fn $list(State(s):State<AppState>,ctx:TenantContext,Query(q):Query<ListQuery>)->Result<Json<ListResponse>,ApiError>{list_kind(State(s),ctx,Query(q),ResourceKind::$kind).await}
 async fn $create(State(s):State<AppState>,ctx:TenantContext,Json(i):Json<$input>)->Result<(StatusCode,Json<ResourceResponse>),ApiError>{create_kind(State(s),ctx,Json(serde_json::to_value(i).map_err(|_|ApiError::InvalidInput)?),ResourceKind::$kind).await}
 async fn $get(State(s):State<AppState>,ctx:TenantContext,Path(id):Path<Uuid>)->Result<Json<ResourceResponse>,ApiError>{get_kind(State(s),ctx,Path(id),ResourceKind::$kind).await}
 async fn $update(State(s):State<AppState>,ctx:TenantContext,Path(id):Path<Uuid>,Json(i):Json<$input>)->Result<Json<ResourceResponse>,ApiError>{update_kind(State(s),ctx,Path(id),Json(serde_json::to_value(i).map_err(|_|ApiError::InvalidInput)?),ResourceKind::$kind).await}
 async fn $delete(State(s):State<AppState>,ctx:TenantContext,Path(id):Path<Uuid>)->Result<StatusCode,ApiError>{delete_kind(State(s),ctx,Path(id),ResourceKind::$kind).await}
}; }
resource_handlers!(list_brand,create_brand,get_brand,update_brand,delete_brand,Brand,BrandInput);
resource_handlers!(list_channel,create_channel,get_channel,update_channel,delete_channel,Channel,ChannelInput);
resource_handlers!(list_calendar,create_calendar,get_calendar,update_calendar,delete_calendar,Calendar,CalendarInput);
resource_handlers!(list_post,create_post,get_post,update_post,delete_post,Post,PostInput);
