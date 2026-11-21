//! The deterministic planner evals (fake provider) run with every `cargo test`, so a
//! validator change that lets a planted bad post through fails CI.
use std::path::Path;

use brandbuild_backend::ai::evals::{load_cases, run_suite, Provider};

#[tokio::test]
async fn validators_catch_every_planted_bad_post() {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("evals");
    let cases = load_cases(&dir).expect("eval cases parse");
    let quality = cases.iter().filter(|c| c.kind == "quality").count();
    let attack = cases.iter().filter(|c| c.kind == "attack").count();
    assert!(
        quality >= 60 && attack >= 30,
        "{quality} quality, {attack} attack cases"
    );

    let report = run_suite(&dir, Provider::Fake, None).await.unwrap();
    let failed: Vec<String> = report
        .cases
        .iter()
        .filter(|c| !c.passed)
        .map(|c| format!("{}: {}", c.id, c.failures.join("; ")))
        .collect();
    assert!(failed.is_empty(), "{}", failed.join("\n"));
}
