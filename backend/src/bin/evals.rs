//! Planner evals.
//!
//!   cargo run --bin evals -- --provider fake     deterministic; also run by `cargo test`
//!   cargo run --bin evals -- --provider gemini   live; needs GEMINI_API_KEY (costs tokens)
//!
//! Optional: `--cases <dir>` (default `evals`), `--only <id-prefix>`.
//! Writes `evals/reports/<provider>-<time>.{md,json}` and exits non-zero if a case fails.
use std::path::PathBuf;

use brandbuild_backend::ai::{
    evals::{load_cases, run_case, Provider, Report},
    Gateway,
};

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().collect();
    let flag = |name: &str| {
        args.iter()
            .position(|a| a == name)
            .and_then(|i| args.get(i + 1))
            .cloned()
    };
    let provider = match flag("--provider").as_deref() {
        Some("gemini") => Provider::Gemini,
        Some("fake") | None => Provider::Fake,
        Some(other) => {
            eprintln!("unknown provider {other}; use fake or gemini");
            std::process::exit(2);
        }
    };
    let dir = PathBuf::from(flag("--cases").unwrap_or_else(|| "evals".into()));
    let only = flag("--only");

    let live = match provider {
        Provider::Fake => None,
        Provider::Gemini => {
            let g = Gateway::from_env();
            if !g.enabled() {
                eprintln!("GEMINI_API_KEY is not set");
                std::process::exit(2);
            }
            Some(g)
        }
    };

    let cases = load_cases(&dir).unwrap_or_else(|e| {
        eprintln!("couldn't read cases: {e}");
        std::process::exit(2);
    });
    let mut results = Vec::new();
    for case in cases
        .iter()
        .filter(|c| only.as_deref().is_none_or(|o| c.id.starts_with(o)))
    {
        let r = run_case(case, provider, live.as_ref()).await;
        println!(
            "{} {} (kept {}/{})",
            if r.passed { "PASS" } else { "FAIL" },
            r.id,
            r.kept,
            r.proposed
        );
        for f in &r.failures {
            println!("     {f}");
        }
        results.push(r);
    }
    let report = Report {
        provider: if provider == Provider::Fake {
            "fake"
        } else {
            "gemini"
        }
        .into(),
        model: live
            .as_ref()
            .map_or_else(|| "fake".into(), |g| g.model.clone()),
        cases: results,
    };

    let reports = dir.join("reports");
    let stamp = chrono::Utc::now().format("%Y%m%d-%H%M%S");
    let base = reports.join(format!("{}-{stamp}", report.provider));
    let written = std::fs::create_dir_all(&reports)
        .and_then(|_| std::fs::write(base.with_extension("md"), report.markdown()))
        .and_then(|_| {
            std::fs::write(
                base.with_extension("json"),
                serde_json::to_string_pretty(&report).unwrap_or_default(),
            )
        });
    if let Err(e) = written {
        eprintln!("couldn't write the report: {e}");
    }
    println!(
        "\n{} of {} passed. Report: {}.md",
        report.passed(),
        report.cases.len(),
        base.display()
    );
    if report.passed() != report.cases.len() {
        std::process::exit(1);
    }
}
