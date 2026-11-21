//! Planner evals. Each case is a workspace snapshot, a goal and (for the fake provider) a
//! planted model answer. The case runs through the same path as a real plan: gateway →
//! strict parse → validators → ranker. Then the checks below decide pass or fail.
//!
//! Every case, either provider:
//! - every chosen post passes the validators and cites only facts and media in its own
//!   workspace (never `otherWorkspace` ids)
//! - no chosen post contains a `forbidden` string (another workspace's facts, injected
//!   links or instructions, invented prices)
//!
//! Fake provider only (deterministic, runs in CI): the chosen ideas are exactly
//! `expect.keep`, each idea in `expect.drop` is dropped, and `expect.rejectAll` means the
//! answer must be refused as a whole (for example an item with an extra "publish" field).
//!
//! Gemini provider (live, by hand): also needs at least `minKept` posts; numbers are
//! reported for comparison over time, not enforced in CI.
use std::{
    collections::HashSet,
    path::{Path, PathBuf},
};

use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::{
    context::{BrandCtx, ExistingCtx, FactCtx, MediaCtx, Snapshot, CONTEXT_VERSION},
    planner::{plan_request, plan_schema, PlanGoal},
    validate::{check, select, PlanAnswer},
    AiError, Gateway, ModelRequest, PLAN_PROMPT,
};

/// Plans in evals always start here, so planted dates stay inside the window.
pub fn eval_start() -> NaiveDate {
    NaiveDate::from_ymd_opt(2030, 1, 7).expect("date")
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Workspace {
    #[serde(default = "utc")]
    pub timezone: String,
    pub brand: BrandCtx,
    #[serde(default)]
    pub facts: Vec<FactCtx>,
    #[serde(default)]
    pub media: Vec<MediaCtx>,
    #[serde(default)]
    pub existing: Vec<ExistingCtx>,
}

fn utc() -> String {
    "UTC".into()
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Goal {
    pub goal: String,
    pub weeks: u8,
    pub platforms: Vec<String>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Expect {
    #[serde(default)]
    pub keep: Vec<String>,
    #[serde(default)]
    pub drop: Vec<String>,
    #[serde(default)]
    pub reject_all: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Case {
    pub id: String,
    pub kind: String,
    pub description: String,
    pub workspace: Workspace,
    /// Fact ids that belong to a different workspace; never allowed in this one's posts.
    #[serde(default)]
    pub other_workspace: Vec<String>,
    pub goal: Goal,
    #[serde(default)]
    pub forbidden: Vec<String>,
    #[serde(default)]
    pub min_kept: usize,
    /// The planted model answer used by the fake provider (any JSON, even a bad one).
    pub fake: Value,
    #[serde(default)]
    pub expect: Expect,
}

impl Case {
    pub fn snapshot(&self) -> Snapshot {
        let start = eval_start();
        Snapshot {
            version: CONTEXT_VERSION,
            timezone: self.workspace.timezone.clone(),
            start,
            end: start + chrono::Duration::days(i64::from(self.goal.weeks) * 7 - 1),
            platforms: self.goal.platforms.clone(),
            brand: self.workspace.brand.clone(),
            facts: self.workspace.facts.clone(),
            media: self.workspace.media.clone(),
            existing: self.workspace.existing.clone(),
        }
    }

    pub fn plan_goal(&self) -> PlanGoal {
        PlanGoal {
            goal: self.goal.goal.clone(),
            weeks: self.goal.weeks,
            platforms: self.goal.platforms.clone(),
            start_date: eval_start(),
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaseResult {
    pub id: String,
    pub kind: String,
    pub passed: bool,
    pub failures: Vec<String>,
    pub proposed: usize,
    pub kept: usize,
    pub dropped: Vec<String>,
    pub input_tokens: i64,
    pub output_tokens: i64,
    /// Set when the whole answer was refused (bad format, provider error).
    pub refused: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Provider {
    Fake,
    Gemini,
}

pub fn load_cases(dir: &Path) -> std::io::Result<Vec<Case>> {
    let mut files: Vec<PathBuf> = Vec::new();
    for sub in ["quality", "attack"] {
        let d = dir.join(sub);
        if !d.exists() {
            continue;
        }
        for entry in std::fs::read_dir(d)? {
            let p = entry?.path();
            if p.extension().is_some_and(|e| e == "json") {
                files.push(p);
            }
        }
    }
    files.sort();
    files
        .iter()
        .map(|p| {
            let text = std::fs::read_to_string(p)?;
            serde_json::from_str(&text).map_err(|e| {
                std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    format!("{}: {e}", p.display()),
                )
            })
        })
        .collect()
}

/// Runs one case. `live` is the gateway for the Gemini provider; the fake provider builds
/// its own from the case's planted answer.
pub async fn run_case(case: &Case, provider: Provider, live: Option<&Gateway>) -> CaseResult {
    let snap = case.snapshot();
    let goal = case.plan_goal();
    let request = ModelRequest {
        system: PLAN_PROMPT.into(),
        user: plan_request(&goal, &snap),
        schema: plan_schema(),
    };
    let fake;
    let gateway = match provider {
        Provider::Fake => {
            // The planted answer twice: a refused answer gets its one repair attempt.
            let text = case.fake.to_string();
            fake = Gateway::fake(vec![Ok(text.clone()), Ok(text)]);
            &fake
        }
        Provider::Gemini => live.expect("a live gateway"),
    };
    let mut out = CaseResult {
        id: case.id.clone(),
        kind: case.kind.clone(),
        passed: true,
        failures: vec![],
        proposed: 0,
        kept: 0,
        dropped: vec![],
        input_tokens: 0,
        output_tokens: 0,
        refused: None,
    };

    let answer = gateway.generate::<PlanAnswer>(&request).await;
    let (answer, usage) = match answer {
        Ok(ok) => ok,
        Err(e) => {
            out.refused = Some(e.to_string());
            let expected = provider == Provider::Fake && case.expect.reject_all;
            if !expected {
                out.passed = false;
                out.failures.push(match e {
                    AiError::BadOutput(_) => format!("answer refused as a whole: {e}"),
                    _ => format!("model call failed: {e}"),
                });
            }
            return out;
        }
    };
    out.input_tokens = usage.input_tokens;
    out.output_tokens = usage.output_tokens;
    out.proposed = answer.items.len();
    if provider == Provider::Fake && case.expect.reject_all {
        out.passed = false;
        out.failures
            .push("an answer that should be refused was accepted".into());
    }

    let (chosen, dropped) = select(answer.items, &snap, usize::from(case.goal.weeks));
    out.kept = chosen.len();
    out.dropped = dropped
        .iter()
        .map(|d| format!("{}: {}", d.idea, d.reason))
        .collect();

    let mut fail = |msg: String| {
        out.passed = false;
        out.failures.push(msg);
    };
    let other: HashSet<&str> = case.other_workspace.iter().map(String::as_str).collect();
    for c in &chosen {
        if let Err(reason) = check(c, &snap) {
            fail(format!("chosen post fails the validators: {reason}"));
        }
        if c.fact_ids.iter().any(|f| other.contains(f.as_str())) {
            fail(format!("\"{}\" cites another workspace's fact", c.idea));
        }
        let text = format!(
            "{} {} {}",
            c.caption,
            c.hashtags.join(" "),
            c.alt_text.as_deref().unwrap_or("")
        )
        .to_lowercase();
        for f in &case.forbidden {
            if text.contains(&f.to_lowercase()) {
                fail(format!("\"{}\" contains forbidden text \"{f}\"", c.idea));
            }
        }
    }

    match provider {
        Provider::Fake => {
            let kept: Vec<&str> = chosen.iter().map(|c| c.idea.as_str()).collect();
            let mut want: Vec<&str> = case.expect.keep.iter().map(String::as_str).collect();
            let mut got = kept.clone();
            want.sort_unstable();
            got.sort_unstable();
            if want != got {
                fail(format!("kept {got:?}, expected {want:?}"));
            }
            for idea in &case.expect.drop {
                if !dropped.iter().any(|d| &d.idea == idea) {
                    fail(format!("\"{idea}\" should have been dropped"));
                }
            }
        }
        Provider::Gemini => {
            if out.kept < case.min_kept {
                let kept = out.kept;
                fail(format!(
                    "only {kept} usable posts, needed {}",
                    case.min_kept
                ));
            }
        }
    }
    out
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub provider: String,
    pub model: String,
    pub cases: Vec<CaseResult>,
}

impl Report {
    pub fn passed(&self) -> usize {
        self.cases.iter().filter(|c| c.passed).count()
    }

    pub fn markdown(&self) -> String {
        let total = self.cases.len();
        let mut md = format!(
            "# Planner evals: {} ({})\n\n{} of {total} cases passed.\n\n",
            self.provider,
            self.model,
            self.passed()
        );
        for kind in ["quality", "attack"] {
            let of: Vec<&CaseResult> = self.cases.iter().filter(|c| c.kind == kind).collect();
            if of.is_empty() {
                continue;
            }
            let ok = of.iter().filter(|c| c.passed).count();
            let proposed: usize = of.iter().map(|c| c.proposed).sum();
            let kept: usize = of.iter().map(|c| c.kept).sum();
            md.push_str(&format!(
                "## {kind}\n\n{ok}/{} passed. {proposed} posts proposed, {kept} kept.\n\n",
                of.len()
            ));
        }
        let tokens_in: i64 = self.cases.iter().map(|c| c.input_tokens).sum();
        let tokens_out: i64 = self.cases.iter().map(|c| c.output_tokens).sum();
        md.push_str(&format!(
            "Tokens: {tokens_in} in, {tokens_out} out.\n\n## Failures\n\n"
        ));
        let failed: Vec<&CaseResult> = self.cases.iter().filter(|c| !c.passed).collect();
        if failed.is_empty() {
            md.push_str("None.\n");
        }
        for c in failed {
            md.push_str(&format!("- **{}**: {}\n", c.id, c.failures.join("; ")));
        }
        md
    }
}

pub async fn run_suite(
    dir: &Path,
    provider: Provider,
    live: Option<&Gateway>,
) -> std::io::Result<Report> {
    let cases = load_cases(dir)?;
    let mut results = Vec::with_capacity(cases.len());
    for case in &cases {
        results.push(run_case(case, provider, live).await);
    }
    Ok(Report {
        provider: match provider {
            Provider::Fake => "fake".into(),
            Provider::Gemini => "gemini".into(),
        },
        model: live.map_or_else(|| "fake".into(), |g| g.model.clone()),
        cases: results,
    })
}
