//! AI gateway (Phase 5). One place that talks to the model provider (Google Gemini via an
//! AI Studio API key), enforces timeouts and token budgets, parses structured output
//! strictly, and reports token use. Everything the model says is checked by the
//! deterministic validators in `validate` before anything is saved, and the model can only
//! ever produce drafts: it has no tools, and approving or publishing is not reachable.
//!
//! Settings (environment):
//!   GEMINI_API_KEY        required to turn AI on; without it AI routes answer 503 ai_unavailable
//!   GEMINI_MODEL          default `gemini-3.8-flash`
//!   GEMINI_API_BASE       default `https://generativelanguage.googleapis.com/v1beta`
//!   AI_TIMEOUT_SECS       default 60
//!   AI_RUN_TOKEN_BUDGET   max output tokens per model call, default 16000
//!   AI_MONTHLY_USD_CAP    per-workspace monthly spend cap, default 5
//!   AI_USD_PER_MTOK_IN / AI_USD_PER_MTOK_OUT   prices used to estimate spend
use std::{collections::VecDeque, sync::Mutex, time::Duration};

use serde::de::DeserializeOwned;
use serde_json::{json, Value};

pub mod context;
pub mod evals;
pub mod planner;
pub mod routes;
pub mod validate;

/// Bumped whenever the plan prompt changes; stored on every run and draft.
pub const PLAN_PROMPT_VERSION: &str = "plan.v1";
pub const GENERATE_PROMPT_VERSION: &str = "generate.v1";
pub const PLAN_PROMPT: &str = include_str!("prompts/plan.v1.txt");
pub const GENERATE_PROMPT: &str = include_str!("prompts/generate.v1.txt");

#[derive(Debug, thiserror::Error)]
pub enum AiError {
    #[error("AI is not configured")]
    NotConfigured,
    #[error("the model took too long")]
    Timeout,
    #[error("the model provider failed: {0}")]
    Provider(String),
    #[error("the model declined: {0}")]
    Blocked(String),
    #[error("the model's answer didn't match the format: {0}")]
    BadOutput(String),
    #[error("this workspace has used its AI budget for the month")]
    OverBudget,
    #[error("the run was canceled")]
    Canceled,
}

pub struct ModelRequest {
    pub system: String,
    pub user: String,
    /// JSON Schema the answer must follow.
    pub schema: Value,
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Usage {
    pub input_tokens: i64,
    pub output_tokens: i64,
}

enum Provider {
    Gemini {
        client: reqwest::Client,
        key: String,
        base: String,
    },
    /// Replays canned answers, for tests and evals.
    Fake(Mutex<VecDeque<Result<String, String>>>),
}

pub struct Gateway {
    provider: Option<Provider>,
    pub model: String,
    pub max_output_tokens: u32,
    pub monthly_usd_cap: f64,
    usd_per_mtok_in: f64,
    usd_per_mtok_out: f64,
}

fn env_or<T: std::str::FromStr>(key: &str, default: T) -> T {
    std::env::var(key)
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(default)
}

impl Gateway {
    fn base(provider: Option<Provider>, model: String) -> Self {
        Self {
            provider,
            model,
            max_output_tokens: env_or("AI_RUN_TOKEN_BUDGET", 16_000),
            monthly_usd_cap: env_or("AI_MONTHLY_USD_CAP", 5.0),
            usd_per_mtok_in: env_or("AI_USD_PER_MTOK_IN", 0.5),
            usd_per_mtok_out: env_or("AI_USD_PER_MTOK_OUT", 3.0),
        }
    }

    pub fn from_env() -> Self {
        let model = std::env::var("GEMINI_MODEL").unwrap_or_else(|_| "gemini-3.8-flash".into());
        let Some(key) = std::env::var("GEMINI_API_KEY")
            .ok()
            .filter(|k| !k.trim().is_empty())
        else {
            tracing::info!("GEMINI_API_KEY not set; AI planning is off");
            return Self::base(None, model);
        };
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(env_or("AI_TIMEOUT_SECS", 60)))
            .build()
            .expect("HTTP client");
        let base = std::env::var("GEMINI_API_BASE")
            .unwrap_or_else(|_| "https://generativelanguage.googleapis.com/v1beta".into());
        tracing::info!(%model, "AI planning on (Gemini)");
        Self::base(Some(Provider::Gemini { client, key, base }), model)
    }

    pub fn disabled() -> Self {
        Self::base(None, "none".into())
    }

    /// A gateway that answers with these replies in order (`Err` simulates a provider failure).
    pub fn fake(replies: Vec<Result<String, String>>) -> Self {
        Self::base(
            Some(Provider::Fake(Mutex::new(replies.into()))),
            "fake".into(),
        )
    }

    pub fn enabled(&self) -> bool {
        self.provider.is_some()
    }

    pub fn cost_usd(&self, usage: Usage) -> f64 {
        (usage.input_tokens as f64 * self.usd_per_mtok_in
            + usage.output_tokens as f64 * self.usd_per_mtok_out)
            / 1_000_000.0
    }

    /// Conservative maximum cost for one call, used for pre-call budget reservations
    /// and timeout (`uncertain`) accounting.
    pub fn max_cost_usd(&self) -> f64 {
        let est = (8_000.0 * self.usd_per_mtok_in
            + f64::from(self.max_output_tokens) * self.usd_per_mtok_out)
            / 1_000_000.0;
        est.max(0.01)
    }

    pub fn pricing_version(&self) -> &'static str {
        "v1"
    }

    async fn call(&self, req: &ModelRequest, user: &str) -> Result<(String, Usage), AiError> {
        match self.provider.as_ref().ok_or(AiError::NotConfigured)? {
            Provider::Fake(replies) => {
                let next = replies.lock().expect("fake replies").pop_front();
                match next {
                    Some(Ok(text)) => Ok((
                        text,
                        Usage {
                            input_tokens: 1000,
                            output_tokens: 500,
                        },
                    )),
                    Some(Err(e)) => Err(AiError::Provider(e)),
                    None => Err(AiError::Provider("no fake reply left".into())),
                }
            }
            Provider::Gemini { client, key, base } => {
                let body = json!({
                    "systemInstruction": { "parts": [{ "text": req.system }] },
                    "contents": [{ "role": "user", "parts": [{ "text": user }] }],
                    "generationConfig": {
                        "responseMimeType": "application/json",
                        "responseJsonSchema": req.schema,
                        "maxOutputTokens": self.max_output_tokens,
                        "temperature": 0.7,
                    },
                });
                let res = client
                    .post(format!("{base}/models/{}:generateContent", self.model))
                    .header("x-goog-api-key", key)
                    .json(&body)
                    .send()
                    .await
                    .map_err(|e| {
                        if e.is_timeout() {
                            AiError::Timeout
                        } else {
                            // Never include the request (it carries the key header) in the error.
                            AiError::Provider(e.without_url().to_string())
                        }
                    })?;
                let status = res.status();
                let out: Value = res
                    .json()
                    .await
                    .map_err(|e| AiError::Provider(e.without_url().to_string()))?;
                if !status.is_success() {
                    let message = out["error"]["message"].as_str().unwrap_or("request failed");
                    return Err(AiError::Provider(format!("{status}: {message}")));
                }
                parse_gemini(&out)
            }
        }
    }

    /// Asks for JSON matching `T`. One repair attempt if the answer doesn't parse.
    pub async fn generate<T: DeserializeOwned>(
        &self,
        req: &ModelRequest,
    ) -> Result<(T, Usage), AiError> {
        let mut usage = Usage::default();
        let mut user = req.user.clone();
        for attempt in 0..2 {
            let (text, used) = self.call(req, &user).await?;
            usage.input_tokens += used.input_tokens;
            usage.output_tokens += used.output_tokens;
            match serde_json::from_str::<T>(&text) {
                Ok(value) => return Ok((value, usage)),
                Err(e) if attempt == 0 => {
                    user = format!(
                        "{}\n\nYour last reply did not match the required JSON format ({e}). Reply again with only JSON that follows the schema exactly, with no extra fields.",
                        req.user
                    );
                }
                Err(e) => return Err(AiError::BadOutput(e.to_string())),
            }
        }
        unreachable!()
    }
}

/// Text and token counts from a Gemini generateContent response.
fn parse_gemini(out: &Value) -> Result<(String, Usage), AiError> {
    if let Some(reason) = out["promptFeedback"]["blockReason"].as_str() {
        return Err(AiError::Blocked(reason.into()));
    }
    let candidate = &out["candidates"][0];
    let finish = candidate["finishReason"].as_str().unwrap_or("STOP");
    if !matches!(finish, "STOP" | "MAX_TOKENS") {
        return Err(AiError::Blocked(finish.into()));
    }
    let text: String = candidate["content"]["parts"]
        .as_array()
        .map(|parts| parts.iter().filter_map(|p| p["text"].as_str()).collect())
        .unwrap_or_default();
    if text.is_empty() {
        return Err(AiError::BadOutput("empty answer".into()));
    }
    let usage = Usage {
        input_tokens: out["usageMetadata"]["promptTokenCount"]
            .as_i64()
            .unwrap_or(0),
        output_tokens: out["usageMetadata"]["candidatesTokenCount"]
            .as_i64()
            .unwrap_or(0)
            + out["usageMetadata"]["thoughtsTokenCount"]
                .as_i64()
                .unwrap_or(0),
    };
    Ok((text, usage))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    #[derive(Deserialize, Debug, PartialEq)]
    #[serde(deny_unknown_fields)]
    struct Answer {
        ok: bool,
    }

    fn req() -> ModelRequest {
        ModelRequest {
            system: "s".into(),
            user: "u".into(),
            schema: json!({}),
        }
    }

    #[tokio::test]
    async fn repairs_one_bad_answer_then_gives_up() {
        let ai = Gateway::fake(vec![Ok("not json".into()), Ok(r#"{"ok":true}"#.into())]);
        let (answer, usage) = ai.generate::<Answer>(&req()).await.unwrap();
        assert_eq!(answer, Answer { ok: true });
        assert_eq!(usage.input_tokens, 2000);

        let ai = Gateway::fake(vec![Ok(r#"{"ok":true,"extra":1}"#.into()), Ok("[]".into())]);
        assert!(matches!(
            ai.generate::<Answer>(&req()).await,
            Err(AiError::BadOutput(_))
        ));
    }

    #[tokio::test]
    async fn no_key_means_not_configured() {
        assert!(matches!(
            Gateway::disabled().generate::<Answer>(&req()).await,
            Err(AiError::NotConfigured)
        ));
    }

    #[test]
    fn reads_gemini_answers() {
        let out = json!({
            "candidates": [{ "content": { "parts": [{ "text": "{\"ok\":" }, { "text": "true}" }] }, "finishReason": "STOP" }],
            "usageMetadata": { "promptTokenCount": 120, "candidatesTokenCount": 30, "thoughtsTokenCount": 5 }
        });
        let (text, usage) = parse_gemini(&out).unwrap();
        assert_eq!(text, "{\"ok\":true}");
        assert_eq!(
            usage,
            Usage {
                input_tokens: 120,
                output_tokens: 35
            }
        );
        assert!(matches!(
            parse_gemini(&json!({ "promptFeedback": { "blockReason": "SAFETY" } })),
            Err(AiError::Blocked(_))
        ));
        assert!(matches!(
            parse_gemini(&json!({ "candidates": [{ "finishReason": "SAFETY" }] })),
            Err(AiError::Blocked(_))
        ));
    }
}
