//! Deterministic checks on everything the model proposes, and the ranker that picks which
//! proposals fill the plan. No model call here: these rules decide, not the model.
//!
//! A proposal is dropped (with a reason the user can see) when it:
//! - targets a platform that wasn't asked for, or a date outside the window
//! - is too long for the platform, or uses a word the brand avoids
//! - cites a fact or media file that isn't in this workspace's snapshot
//! - states a price, percentage, opening time or "best/#1"-style claim that no cited,
//!   verified fact backs (CA-6)
//! - links to a site no cited, verified fact mentions
//! - is a near-copy of something already planned or already chosen
use std::collections::{HashMap, HashSet};
use std::sync::LazyLock;

use chrono::{NaiveDate, NaiveTime};
use regex::Regex;
use serde::{Deserialize, Serialize};

use super::context::{FactCtx, Snapshot};

/// One post the model proposes. Unknown fields are refused.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Candidate {
    pub platform: String,
    pub date: NaiveDate,
    pub local_time: String,
    pub pillar: String,
    pub idea: String,
    pub caption: String,
    #[serde(default)]
    pub hashtags: Vec<String>,
    #[serde(default)]
    pub alt_text: Option<String>,
    #[serde(default)]
    pub media_id: Option<String>,
    #[serde(default)]
    pub image_brief: Option<String>,
    #[serde(default)]
    pub fact_ids: Vec<String>,
    #[serde(default)]
    pub reasoning: String,
    #[serde(default)]
    pub warnings: Vec<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PlanAnswer {
    pub items: Vec<Candidate>,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Dropped {
    pub platform: String,
    pub date: NaiveDate,
    pub idea: String,
    pub reason: String,
}

/// Posts per platform per week the planner aims for.
pub const PER_WEEK: usize = 3;
/// How similar (0..1) two captions may be before the later one counts as a repeat.
pub const REPEAT_LIMIT: f64 = 0.8;

pub fn platform_limit(platform: &str) -> usize {
    match platform {
        "li" => 3000,
        "fb" => 63_206,
        _ => 2200,
    }
}

static MONEY: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)(?:₦|\$|£|€|\bngn\s?|\busd\s?|\bn)\s?(\d[\d,]*(?:\.\d+)?)\s?(k\b)?|(\d[\d,]*(?:\.\d+)?)\s?(k\s)?(?:naira|dollars?|pounds?|euros?)\b").unwrap()
});
static PERCENT: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)(\d+(?:\.\d+)?)\s?(?:%|per\s?cent\b)").unwrap());
static HOURS: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\b(\d{1,2})(?::(\d{2}))?\s?(am|pm)\b").unwrap());
static SUPERLATIVE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)(?:\bbest\b|#1\b|\bnumber one\b|\bcheapest\b|\bguarantee[ds]?\b|\blowest price\b|\btop[- ]rated\b|\bno\.? ?1\b)").unwrap()
});
static LINK: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\b(?:https?://|www\.)[^\s]+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|co|ng|uk|shop|store|link|xyz|app|ly|me|info|biz)\b(?:/[^\s]*)?").unwrap()
});
static NUMBER: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\d[\d,]*(?:\.\d+)?").unwrap());

fn num(text: &str) -> Option<f64> {
    text.replace(',', "").parse().ok()
}

/// Every number a fact states, in its words or its price.
fn fact_numbers(fact: &FactCtx) -> Vec<f64> {
    let mut out: Vec<f64> = NUMBER
        .find_iter(&fact.value)
        .chain(NUMBER.find_iter(&fact.label))
        .filter_map(|m| num(m.as_str()))
        .collect();
    if let Some(price) = fact.price.as_deref().and_then(num) {
        out.push(price);
    }
    out
}

/// The claims in a caption that need a fact behind them.
pub fn claims(text: &str) -> (Vec<f64>, bool) {
    let mut numbers = Vec::new();
    for c in MONEY.captures_iter(text) {
        let (n, thousands) = match c.get(1) {
            Some(n) => (n.as_str(), c.get(2).is_some()),
            None => (c.get(3).map_or("", |m| m.as_str()), c.get(4).is_some()),
        };
        if let Some(v) = num(n) {
            numbers.push(if thousands { v * 1000.0 } else { v });
        }
    }
    for c in PERCENT.captures_iter(text) {
        if let Some(v) = num(&c[1]) {
            numbers.push(v);
        }
    }
    for c in HOURS.captures_iter(text) {
        if let Some(v) = num(&c[1]) {
            numbers.push(v);
        }
    }
    (numbers, SUPERLATIVE.is_match(text))
}

/// The sites a caption links to, as bare lowercase hosts ("glow.ng").
pub fn links(text: &str) -> Vec<String> {
    LINK.find_iter(text)
        .map(|m| {
            let l = m.as_str().to_lowercase();
            let l = l
                .trim_start_matches("https://")
                .trim_start_matches("http://")
                .trim_start_matches("www.");
            let host = l.split(['/', '?', '#']).next().unwrap_or("");
            host.trim_end_matches(['.', ',', '!', ')', ';', ':'])
                .to_owned()
        })
        .filter(|h| !h.is_empty())
        .collect()
}

fn words(text: &str) -> Vec<String> {
    text.to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
        .map(str::to_owned)
        .collect()
}

fn trigrams(text: &str) -> HashSet<String> {
    let w = words(text);
    if w.len() < 3 {
        return w.into_iter().collect();
    }
    w.windows(3).map(|t| t.join(" ")).collect()
}

/// Jaccard similarity of word trigrams, 0..1.
pub fn similarity(a: &str, b: &str) -> f64 {
    let (a, b) = (trigrams(a), trigrams(b));
    if a.is_empty() || b.is_empty() {
        return 0.0;
    }
    let shared = a.intersection(&b).count() as f64;
    shared / (a.len() as f64 + b.len() as f64 - shared)
}

fn contains_phrase(text_words: &[String], phrase: &str) -> bool {
    let p = words(phrase);
    !p.is_empty() && text_words.windows(p.len()).any(|w| w == p.as_slice())
}

/// Ok, or the reason this proposal can't be used.
pub fn check(c: &Candidate, snap: &Snapshot) -> Result<(), String> {
    if !snap.platforms.contains(&c.platform) {
        return Err(format!("not a platform you asked for ({})", c.platform));
    }
    if c.date < snap.start || c.date > snap.end {
        return Err("date outside the plan".into());
    }
    if NaiveTime::parse_from_str(&c.local_time, "%H:%M").is_err() {
        return Err("time isn't HH:MM".into());
    }
    if c.caption.trim().is_empty() || c.idea.trim().is_empty() {
        return Err("empty caption".into());
    }
    let full = format!("{} {}", c.caption, c.hashtags.join(" "));
    if full.chars().count() > platform_limit(&c.platform) {
        return Err("too long for the platform".into());
    }
    if c.hashtags.len() > 30
        || c.alt_text
            .as_ref()
            .is_some_and(|t| t.chars().count() > 1000)
    {
        return Err("too many hashtags or alt text too long".into());
    }
    let text_words = words(&format!("{full} {}", c.alt_text.as_deref().unwrap_or("")));
    if let Some(bad) = snap
        .brand
        .words_avoid
        .iter()
        .find(|w| contains_phrase(&text_words, w))
    {
        return Err(format!("uses a word you avoid (\"{bad}\")"));
    }
    if let Some(media) = &c.media_id {
        if !snap.media.iter().any(|m| &m.id == media) {
            return Err("points to a photo that isn't in your library".into());
        }
    }
    let mut cited = Vec::new();
    for id in &c.fact_ids {
        match snap.facts.iter().find(|f| &f.id == id) {
            Some(f) => cited.push(f),
            None => return Err("cites a fact that isn't verified in your brand kit".into()),
        }
    }
    let (numbers, superlative) = claims(&full);
    let backed: Vec<f64> = cited.iter().flat_map(|f| fact_numbers(f)).collect();
    if let Some(n) = numbers
        .iter()
        .find(|n| !backed.iter().any(|b| (*b - **n).abs() < 0.005))
    {
        return Err(format!("states {n} without a verified fact behind it"));
    }
    let alt = c.alt_text.as_deref().unwrap_or("");
    if let Some(link) = links(&format!("{full} {alt}")).into_iter().find(|host| {
        !cited.iter().any(|f| {
            format!("{} {}", f.label, f.value)
                .to_lowercase()
                .contains(host.as_str())
        })
    }) {
        return Err(format!("links to {link}, which no verified fact mentions"));
    }
    if superlative && !cited.iter().any(|f| f.kind == "claim") {
        return Err("makes a \"best\" or \"#1\" claim without a verified claim fact".into());
    }
    Ok(())
}

/// Checks every proposal, then greedily fills `weeks` × PER_WEEK slots per platform,
/// penalising repeats of the same pillar and crowded days. Order of the model's answer
/// breaks ties, so the result is deterministic.
pub fn select(
    cands: Vec<Candidate>,
    snap: &Snapshot,
    weeks: usize,
) -> (Vec<Candidate>, Vec<Dropped>) {
    let mut dropped = Vec::new();
    let mut valid = Vec::new();
    for c in cands {
        let repeat = snap
            .existing
            .iter()
            .any(|e| similarity(&e.summary, &c.caption) > REPEAT_LIMIT);
        match check(&c, snap) {
            Err(reason) => dropped.push(drop(&c, reason)),
            Ok(()) if repeat => dropped.push(drop(&c, "repeats something already planned".into())),
            Ok(()) => valid.push(c),
        }
    }
    let quota = weeks * PER_WEEK;
    let mut chosen: Vec<Candidate> = Vec::new();
    let mut per_platform: HashMap<String, usize> = HashMap::new();
    let mut per_pillar: HashMap<(String, String), usize> = HashMap::new();
    let mut per_day: HashMap<(String, NaiveDate), usize> = HashMap::new();
    let mut pool: Vec<Candidate> = valid;
    while !pool.is_empty() {
        let mut best: Option<(usize, f64)> = None;
        for (i, c) in pool.iter().enumerate() {
            if per_platform.get(&c.platform).copied().unwrap_or(0) >= quota {
                continue;
            }
            let pillar = per_pillar
                .get(&(c.platform.clone(), c.pillar.to_lowercase()))
                .copied()
                .unwrap_or(0) as f64;
            let day = per_day
                .get(&(c.platform.clone(), c.date))
                .copied()
                .unwrap_or(0) as f64;
            let score = 1.0 - 0.3 * pillar - 0.6 * day;
            if best.is_none_or(|(_, s)| score > s) {
                best = Some((i, score));
            }
        }
        let Some((i, _)) = best else { break };
        let c = pool.remove(i);
        if chosen
            .iter()
            .any(|k| similarity(&k.caption, &c.caption) > REPEAT_LIMIT)
        {
            dropped.push(drop(&c, "too close to another post in this plan".into()));
            continue;
        }
        *per_platform.entry(c.platform.clone()).or_default() += 1;
        *per_pillar
            .entry((c.platform.clone(), c.pillar.to_lowercase()))
            .or_default() += 1;
        *per_day.entry((c.platform.clone(), c.date)).or_default() += 1;
        chosen.push(c);
    }
    for c in pool {
        dropped.push(drop(&c, "not needed: the plan was already full".into()));
    }
    chosen.sort_by(|a, b| {
        (a.date, &a.local_time, &a.platform).cmp(&(b.date, &b.local_time, &b.platform))
    });
    (chosen, dropped)
}

fn drop(c: &Candidate, reason: String) -> Dropped {
    Dropped {
        platform: c.platform.clone(),
        date: c.date,
        idea: c.idea.clone(),
        reason,
    }
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use crate::ai::context::{BrandCtx, ExistingCtx, MediaCtx};

    pub fn snapshot() -> Snapshot {
        Snapshot {
            version: "context.v1",
            timezone: "Africa/Lagos".into(),
            start: NaiveDate::from_ymd_opt(2030, 1, 7).unwrap(),
            end: NaiveDate::from_ymd_opt(2030, 1, 20).unwrap(),
            platforms: vec!["ig".into(), "fb".into()],
            brand: BrandCtx {
                name: "Glow".into(),
                words_avoid: vec!["cheap".into(), "miracle cure".into()],
                ..Default::default()
            },
            facts: vec![
                FactCtx {
                    id: "f-offer".into(),
                    kind: "offer".into(),
                    label: "Weekend deal".into(),
                    value: "20% off lip gloss".into(),
                    price: Some("4500.00".into()),
                    currency: Some("NGN".into()),
                    ends_at: None,
                },
                FactCtx {
                    id: "f-hours".into(),
                    kind: "hours".into(),
                    label: "Opening hours".into(),
                    value: "Open 9am to 6pm, Monday to Saturday".into(),
                    price: None,
                    currency: None,
                    ends_at: None,
                },
                FactCtx {
                    id: "f-claim".into(),
                    kind: "claim".into(),
                    label: "Award".into(),
                    value: "Voted best lip gloss in Lagos 2029".into(),
                    price: None,
                    currency: None,
                    ends_at: None,
                },
            ],
            media: vec![MediaCtx {
                id: "m-1".into(),
                name: "gloss.jpg".into(),
                kind: "image".into(),
                tags: vec![],
            }],
            existing: vec![ExistingCtx {
                date: NaiveDate::from_ymd_opt(2030, 1, 8).unwrap(),
                platforms: vec!["ig".into()],
                summary: "Meet the new shades of our everyday lip gloss collection".into(),
            }],
        }
    }

    #[test]
    fn links_need_a_verified_fact() {
        let mut snap = snapshot();
        snap.facts[0].value = "20% off lip gloss at glow.ng/shop".into();
        let mut c = cand(
            "ig",
            9,
            "New shades are in. Order at https://glow-deals.xyz/now",
        );
        assert!(check(&c, &snap).unwrap_err().contains("glow-deals.xyz"));
        c.caption = "Shop the range at www.glow.ng today".into();
        assert!(check(&c, &snap).is_err(), "not cited yet");
        c.fact_ids = vec!["f-offer".into()];
        c.caption = "Shop the range at www.glow.ng today".into();
        assert_eq!(check(&c, &snap), Ok(()));
        c.alt_text = Some("Visit evil.example.com".into());
        assert!(check(&c, &snap).is_err());
        assert_eq!(links("link in bio, see you soon."), Vec::<String>::new());
    }

    pub fn cand(platform: &str, day: u32, caption: &str) -> Candidate {
        Candidate {
            platform: platform.into(),
            date: NaiveDate::from_ymd_opt(2030, 1, day).unwrap(),
            local_time: "18:00".into(),
            pillar: "product".into(),
            idea: format!("Idea {day}"),
            caption: caption.into(),
            hashtags: vec!["#glow".into()],
            alt_text: None,
            media_id: None,
            image_brief: Some("Close-up of gloss".into()),
            fact_ids: vec![],
            reasoning: String::new(),
            warnings: vec![],
        }
    }

    #[test]
    fn finds_the_claims_that_need_facts() {
        let (n, sup) = claims("Now ₦4,500 — 20% off, open 9am. The best gloss!");
        assert_eq!(n, vec![4500.0, 20.0, 9.0]);
        assert!(sup);
        assert_eq!(claims("Only N4.5k this week").0, vec![4500.0]);
        assert_eq!(claims("Just 3000 naira").0, vec![3000.0]);
        assert_eq!(claims("Shop our new shades on Friday").0, Vec::<f64>::new());
        assert!(!claims("Our bestseller is back").1);
    }

    #[test]
    fn unsupported_prices_and_claims_are_dropped() {
        let s = snapshot();
        let mut c = cand("ig", 9, "Weekend deal: 20% off lip gloss, now ₦4,500");
        assert!(check(&c, &s)
            .unwrap_err()
            .contains("without a verified fact"));
        c.fact_ids = vec!["f-offer".into()];
        assert_eq!(check(&c, &s), Ok(()));
        c.caption = "Weekend deal: 30% off".into();
        assert!(
            check(&c, &s).is_err(),
            "a different number than the fact says"
        );
        c.caption = "The best gloss in Lagos".into();
        assert!(check(&c, &s).unwrap_err().contains("claim"));
        c.fact_ids.push("f-claim".into());
        assert_eq!(check(&c, &s), Ok(()));
        c.caption = "Visit us from 9am".into();
        assert!(check(&c, &s).is_err());
        c.fact_ids = vec!["f-hours".into()];
        assert_eq!(check(&c, &s), Ok(()));
    }

    #[test]
    fn invented_ids_and_off_limits_targets_are_dropped() {
        let s = snapshot();
        let mut c = cand("ig", 9, "Fresh shades");
        c.fact_ids = vec!["fact-from-another-workspace".into()];
        assert!(check(&c, &s).is_err());
        let mut c = cand("ig", 9, "Fresh shades");
        c.media_id = Some("m-unknown".into());
        assert!(check(&c, &s).is_err());
        assert!(check(&cand("tt", 9, "Fresh shades"), &s).is_err());
        assert!(check(&cand("ig", 21, "Fresh shades"), &s).is_err());
        assert!(check(&cand("ig", 9, "So cheap!"), &s)
            .unwrap_err()
            .contains("avoid"));
        assert!(check(&cand("ig", 9, "Not a Miracle Cure, just gloss"), &s).is_err());
        let mut long = cand("ig", 9, &"a".repeat(2200));
        assert!(check(&long, &s).is_err());
        long.platform = "fb".into();
        assert_eq!(check(&long, &s), Ok(()));
    }

    #[test]
    fn ranker_fills_quota_spreads_pillars_and_skips_repeats() {
        let s = snapshot();
        let mut cands = Vec::new();
        for day in 7..=20 {
            let mut c = cand(
                "ig",
                day,
                &format!("Post number {day} about something different {}", day * 7),
            );
            c.pillar = if day % 2 == 0 {
                "tips".into()
            } else {
                "product".into()
            };
            cands.push(c);
        }
        cands.push(cand(
            "ig",
            9,
            "Meet the new shades of our everyday lip gloss collection",
        ));
        let (chosen, dropped) = select(cands, &s, 2);
        assert_eq!(chosen.len(), 6);
        assert!(dropped.iter().any(|d| d.reason.contains("already planned")));
        assert!(dropped.iter().any(|d| d.reason.contains("already full")));
        let tips = chosen.iter().filter(|c| c.pillar == "tips").count();
        assert!((2..=4).contains(&tips), "pillars are mixed: {tips}");
        let days: HashSet<NaiveDate> = chosen.iter().map(|c| c.date).collect();
        assert_eq!(days.len(), 6, "one post per day before doubling up");
    }

    #[test]
    fn similarity_is_symmetric_and_bounded() {
        let a = "Our new lip gloss shades are here for the weekend";
        assert!(similarity(a, a) > 0.99);
        assert!(similarity(a, "Totally different words about shoes and bags today") < 0.1);
        assert!((similarity(a, "x y z") - similarity("x y z", a)).abs() < 1e-9);
    }
}
