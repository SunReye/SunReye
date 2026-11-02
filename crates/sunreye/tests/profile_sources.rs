//! Profile sources fetched from a local HTTPS server whose root is the test's own. The profile files it
//! serves are the compiled-in set's own JSON, so a fetched profile must decode the oracle corpus like the
//! compiled-in copy.

#![allow(clippy::expect_used, reason = "helpers outside #[test] fns may panic like the tests")]

use std::collections::BTreeMap;
use std::path::Path;
use std::time::Duration;

use serde_json::{Value, json};
use sunreye::decode::{Words, decode, plan_reads};
use sunreye::https::Limits;
use sunreye::profile::Bundle;
use sunreye::sources::{BUDGET, Budget, Source, SourceError, fetch};
use tokio_rustls::rustls::pki_types::CertificateDer;

mod support;
use support::{Ca, Instead, Site, index_of, official_files, serve_site, serve_site_with, site};

const CAP: usize = 256 * 1024;

fn source(port: u16) -> Source {
    Source { base_url: format!("https://localhost:{port}/repo/"), index_path: "index.json".into() }
}

fn limits() -> Limits {
    Limits { timeout: Duration::from_secs(5), max_bytes: CAP }
}

async fn fetch_from(ca: &Ca, site: Site) -> Result<sunreye::sources::Fetched, SourceError> {
    let port = serve_site(ca, site).await;
    let roots: Vec<CertificateDer<'static>> = vec![ca.root()];
    fetch(&source(port), limits(), BUDGET, &roots, |_| false).await
}

fn corpus() -> Vec<Value> {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/oracle/profile-decode.ndjson");
    let text = std::fs::read_to_string(path).expect("corpus");
    text.lines().map(|line| serde_json::from_str(line).expect("json")).collect()
}

/// The registers a corpus case answers, by address.
fn answered(case: &Value) -> Words {
    let mut words = Words::new();
    for run in case["runs"].as_array().expect("runs") {
        let start = u16::try_from(run["start"].as_u64().expect("start")).expect("u16");
        for (addr, word) in (start..).zip(run["words"].as_array().expect("words")) {
            words.insert(addr, u16::try_from(word.as_u64().expect("word")).expect("u16"));
        }
    }
    words
}

#[tokio::test]
async fn a_fetched_profile_decodes_the_oracle_cases_like_the_compiled_in_copy() {
    let ca = Ca::new("test root");
    let fetched = fetch_from(&ca, site(&official_files())).await.expect("fetched");
    assert_decodes_the_oracle(&fetched);
}

fn assert_decodes_the_oracle(fetched: &sunreye::sources::Fetched) {
    assert_eq!(fetched.skipped, []);
    let bundle = Bundle::official().expect("bundle");
    let mut cases = 0;
    for row in corpus() {
        let id = row["profile"]["id"].as_str().expect("id");
        let copy = fetched.profiles.iter().find(|p| p.profile.id == id).expect("fetched profile");
        let builtin = bundle.profile(id).expect("compiled-in profile");
        let blocks: Vec<(u64, u64)> = row["blocks"]
            .as_array()
            .expect("blocks")
            .iter()
            .map(|b| (b["start"].as_u64().expect("start"), b["count"].as_u64().expect("count")))
            .collect();
        let planned: Vec<(u64, u64)> =
            plan_reads(&copy.profile).iter().map(|b| (u64::from(b.start), u64::from(b.count))).collect();
        assert_eq!(planned, blocks, "{id} blocks");
        for case in row["cases"].as_array().expect("cases") {
            let words = answered(case);
            let want: BTreeMap<String, f64> = case["readings"]
                .as_object()
                .expect("readings")
                .iter()
                .map(|(key, value)| (key.clone(), value.as_f64().expect("number")))
                .collect();
            let got: BTreeMap<String, f64> = decode(&copy.profile, &words).into_iter().collect();
            assert_eq!(got, want, "{id} {}", case["name"]);
            assert_eq!(decode(&copy.profile, &words), decode(builtin, &words), "{id} {}", case["name"]);
            cases += 1;
        }
    }
    assert_eq!(cases, 20 * 6);
}

fn ids(fetched: &sunreye::sources::Fetched) -> Vec<&str> {
    fetched.profiles.iter().map(|p| p.profile.id.as_str()).collect()
}

fn first_two() -> Vec<(String, Value)> {
    official_files().into_iter().take(2).collect()
}

#[tokio::test]
async fn a_valid_index_loads_every_profile_it_lists() {
    let ca = Ca::new("test root");
    let files = first_two();
    let fetched = fetch_from(&ca, site(&files)).await.expect("fetched");
    assert_eq!(ids(&fetched), [files[0].0.as_str(), files[1].0.as_str()]);
    assert_eq!(fetched.skipped, []);
}

#[tokio::test]
async fn an_empty_index_loads_nothing() {
    let ca = Ca::new("test root");
    let fetched = fetch_from(&ca, site(&[])).await.expect("fetched");
    assert_eq!((fetched.profiles.len(), fetched.skipped.len()), (0, 0));
}

#[tokio::test]
async fn a_missing_index_is_an_error_naming_the_status() {
    let ca = Ca::new("test root");
    let mut files = site(&first_two());
    files.remove("/repo/index.json");
    let err = fetch_from(&ca, files).await.expect_err("no index");
    assert!(matches!(err, SourceError::Index(sunreye::https::GetError::Status(404))), "{err:?}");
}

#[tokio::test]
async fn an_index_that_is_not_an_index_is_an_error() {
    let ca = Ca::new("test root");
    for body in [&b"not json"[..], br#"{"profiles": 5}"#, br#"{"profiles": [{"id": "x"}]}"#, b"[]"] {
        let mut files = site(&[]);
        files.insert("/repo/index.json".into(), body.to_vec());
        let err = fetch_from(&ca, files).await.expect_err("malformed");
        assert!(matches!(err, SourceError::MalformedIndex(_)), "{body:?}: {err:?}");
    }
}

#[tokio::test]
async fn an_invalid_profile_is_skipped_with_its_reason_and_the_rest_still_load() {
    let ca = Ca::new("test root");
    let files = first_two();
    let mut broken = files[0].1.clone();
    broken.as_object_mut().expect("object").remove("metrics");
    let mut served = site(&files);
    served.insert(format!("/repo/profiles/{}.json", files[0].0), broken.to_string().into_bytes());
    let fetched = fetch_from(&ca, served).await.expect("fetched");
    assert_eq!(ids(&fetched), [files[1].0.as_str()]);
    assert_eq!(fetched.skipped.len(), 1);
    assert_eq!(fetched.skipped[0].path, format!("profiles/{}.json", files[0].0));
    assert!(fetched.skipped[0].reason.contains("metrics"), "{:?}", fetched.skipped[0]);
}

#[tokio::test]
async fn a_listed_file_that_is_missing_or_not_json_or_holds_another_id_is_skipped() {
    let ca = Ca::new("test root");
    let files = first_two();
    let mut served = site(&files);
    served.remove(&format!("/repo/profiles/{}.json", files[0].0));
    served.insert(format!("/repo/profiles/{}.json", files[1].0), b"<html>".to_vec());
    let mut extra = official_files().remove(2);
    let wrong = format!("/repo/profiles/{}.json", extra.0);
    let mut listing = index_of(&files);
    listing["profiles"]
        .as_array_mut()
        .expect("array")
        .push(json!({"id": "other", "path": format!("profiles/{}.json", extra.0)}));
    served.insert("/repo/index.json".into(), listing.to_string().into_bytes());
    extra.1["id"] = json!(extra.0);
    served.insert(wrong, extra.1.to_string().into_bytes());
    let fetched = fetch_from(&ca, served).await.expect("fetched");
    assert_eq!(fetched.profiles.len(), 0);
    let reasons: Vec<&str> = fetched.skipped.iter().map(|s| s.reason.as_str()).collect();
    assert_eq!(reasons[0], "status 404");
    assert!(reasons[1].starts_with("not JSON: expected value at line 1"), "{reasons:?}");
    assert_eq!(reasons[2], "the file holds another id than the index lists");
}

#[tokio::test]
async fn a_profile_listed_twice_loads_once() {
    let ca = Ca::new("test root");
    let files = first_two();
    let mut listing = index_of(&files);
    let again = listing["profiles"][0].clone();
    listing["profiles"].as_array_mut().expect("array").push(again);
    let mut served = site(&files);
    served.insert("/repo/index.json".into(), listing.to_string().into_bytes());
    let fetched = fetch_from(&ca, served).await.expect("fetched");
    assert_eq!(fetched.profiles.len(), 2);
    assert_eq!(fetched.skipped.len(), 1);
    assert!(fetched.skipped[0].reason.contains("twice"), "{:?}", fetched.skipped[0]);
}

#[tokio::test]
async fn an_oversized_index_is_an_error_and_an_oversized_profile_is_skipped() {
    let ca = Ca::new("test root");
    let files = first_two();
    let mut served = site(&files);
    let mut huge = files[0].1.clone();
    huge["padding"] = json!("x".repeat(CAP));
    served.insert(format!("/repo/profiles/{}.json", files[0].0), huge.to_string().into_bytes());
    let fetched = fetch_from(&ca, served).await.expect("fetched");
    assert_eq!(ids(&fetched), [files[1].0.as_str()]);
    assert_eq!(fetched.skipped[0].reason, format!("body exceeds {CAP} bytes"));

    let mut served = site(&files);
    served.insert("/repo/index.json".into(), vec![b' '; CAP + 1]);
    let err = fetch_from(&ca, served).await.expect_err("too large");
    assert!(
        matches!(err, SourceError::Index(sunreye::https::GetError::TooLarge { max_bytes: CAP })),
        "{err:?}"
    );
}

#[tokio::test]
async fn a_listed_path_that_leaves_the_source_is_skipped_and_never_requested() {
    let ca = Ca::new("test root");
    let files = first_two();
    let mut served = site(&files);
    served.insert("/secret.json".into(), files[0].1.to_string().into_bytes());
    let mut listing = index_of(&files[1..]);
    for path in [
        "../secret.json",
        "/secret.json",
        "https://localhost:1/repo/x.json",
        "profiles/%2e%2e/%2e%2e/secret.json",
    ] {
        listing["profiles"].as_array_mut().expect("array").push(json!({"id": files[0].0, "path": path}));
    }
    served.insert("/repo/index.json".into(), listing.to_string().into_bytes());
    let fetched = fetch_from(&ca, served).await.expect("fetched");
    assert_eq!(ids(&fetched), [files[1].0.as_str()]);
    assert_eq!(fetched.skipped.len(), 4);
    assert!(
        fetched.skipped.iter().all(|s| s.reason == "the path leaves the source"),
        "{:?}",
        fetched.skipped
    );
}

#[tokio::test]
async fn the_base_may_omit_its_trailing_slash() {
    let ca = Ca::new("test root");
    let port = serve_site(&ca, site(&first_two())).await;
    let source =
        Source { base_url: format!("https://localhost:{port}/repo"), index_path: "index.json".into() };
    let fetched = fetch(&source, limits(), BUDGET, &[ca.root()], |_| false).await.expect("fetched");
    assert_eq!(fetched.profiles.len(), 2);
}

#[tokio::test]
async fn a_source_url_that_is_not_plain_https_is_refused_before_any_request() {
    let bad = [
        ("http://example.org/", "index.json"),
        ("ftp://example.org/", "index.json"),
        ("not a url", "index.json"),
        ("https://user:secret@example.org/", "index.json"),
        ("https://example.org/?token=secret", "index.json"),
        ("https://example.org/#frag", "index.json"),
        ("https://example.org/repo/", "../index.json"),
        ("https://example.org/repo/", "index.json?token=secret"),
        ("https://example.org/repo/", "https://other.example/index.json"),
    ];
    for (base_url, index_path) in bad {
        let source = Source { base_url: base_url.into(), index_path: index_path.into() };
        let err = fetch(&source, limits(), BUDGET, &[], |_| false).await.expect_err(base_url);
        assert!(matches!(err, SourceError::Url(_)), "{base_url} {index_path}: {err:?}");
        assert!(source.normalised().is_err(), "{base_url} {index_path}");
    }
}

#[test]
fn a_source_is_stored_in_its_canonical_form() {
    let source = Source { base_url: " https://Example.org/a/b ".into(), index_path: " index.json ".into() };
    let canonical = source.normalised().expect("valid");
    assert_eq!(canonical.base_url, "https://example.org/a/b/");
    assert_eq!(canonical.index_path, "index.json");
    assert_eq!(canonical.normalised().expect("valid"), canonical);
}

#[tokio::test]
async fn an_index_that_redirects_to_another_origin_is_an_error_and_the_target_is_never_read() {
    let ca = Ca::new("test root");
    let elsewhere = serve_site(&ca, site(&first_two())).await;
    let to = format!("https://localhost:{elsewhere}/repo/index.json");
    let instead = BTreeMap::from([("/repo/index.json".to_owned(), Instead::Redirect(to))]);
    let port = serve_site_with(&ca, Site::new(), instead).await;
    let err = fetch(&source(port), limits(), BUDGET, &[ca.root()], |_| false).await.expect_err("redirected");
    assert!(matches!(err, SourceError::Index(sunreye::https::GetError::Status(302))), "{err:?}");
}

#[tokio::test]
async fn a_profile_file_that_redirects_is_skipped_even_within_the_source() {
    let ca = Ca::new("test root");
    let files = first_two();
    let mut served = site(&files);
    let moved = format!("/repo/profiles/{}.json", files[0].0);
    let target = served.remove(&moved).expect("file");
    served.insert("/repo/moved.json".into(), target);
    let instead = BTreeMap::from([(moved, Instead::Redirect("/repo/moved.json".into()))]);
    let port = serve_site_with(&ca, served, instead).await;
    let fetched = fetch(&source(port), limits(), BUDGET, &[ca.root()], |_| false).await.expect("fetched");
    assert_eq!(ids(&fetched), [files[1].0.as_str()]);
    assert_eq!(fetched.skipped[0].reason, "status 302");
}

fn three() -> Vec<(String, Value)> {
    official_files().into_iter().take(3).collect()
}

fn size(file: &(String, Value)) -> usize {
    file.1.to_string().len()
}

async fn fetch_within(ca: &Ca, site: Site, budget: Budget) -> Result<sunreye::sources::Fetched, SourceError> {
    let port = serve_site(ca, site).await;
    fetch(&source(port), limits(), budget, &[ca.root()], |_| false).await
}

#[tokio::test]
async fn an_entry_is_fetched_only_while_the_bytes_already_loaded_are_under_the_budget() {
    let ca = Ca::new("test root");
    let files = three();
    let first = size(&files[0]);
    let held = Budget { bytes: first, ..BUDGET };
    let fetched = fetch_within(&ca, site(&files), held).await.expect("fetched");
    assert_eq!(ids(&fetched), [files[0].0.as_str()]);
    let reason = format!("the source holds more than {first} bytes");
    assert_eq!(fetched.skipped.iter().map(|s| s.reason.as_str()).collect::<Vec<_>>(), [&reason; 2]);

    let roomy = Budget { bytes: first + 1, ..BUDGET };
    let fetched = fetch_within(&ca, site(&files), roomy).await.expect("fetched");
    assert_eq!(ids(&fetched), [files[0].0.as_str(), files[1].0.as_str()]);
    assert_eq!(fetched.skipped.len(), 1);
}

#[tokio::test]
async fn an_invalid_file_still_spends_the_budget() {
    let ca = Ca::new("test root");
    let files = first_two();
    let mut broken = files[0].1.clone();
    broken.as_object_mut().expect("object").remove("metrics");
    let mut served = site(&files);
    served.insert(format!("/repo/profiles/{}.json", files[0].0), broken.to_string().into_bytes());
    let budget = Budget { bytes: broken.to_string().len(), ..BUDGET };
    let fetched = fetch_within(&ca, served, budget).await.expect("fetched");
    assert_eq!(ids(&fetched), [] as [&str; 0]);
    assert!(fetched.skipped[0].reason.contains("metrics"), "{:?}", fetched.skipped);
    assert!(fetched.skipped[1].reason.starts_with("the source holds more than"), "{:?}", fetched.skipped);
}

#[tokio::test]
async fn a_file_over_the_request_cap_spends_the_whole_cap() {
    let ca = Ca::new("test root");
    let files = first_two();
    let mut huge = files[0].1.clone();
    huge["padding"] = json!("x".repeat(CAP));
    let mut served = site(&files);
    served.insert(format!("/repo/profiles/{}.json", files[0].0), huge.to_string().into_bytes());
    let fetched = fetch_within(&ca, served, Budget { bytes: CAP, ..BUDGET }).await.expect("fetched");
    assert_eq!(fetched.skipped[0].reason, format!("body exceeds {CAP} bytes"));
    assert!(fetched.skipped[1].reason.starts_with("the source holds more than"), "{:?}", fetched.skipped);
}

#[tokio::test]
async fn an_index_listing_more_files_than_the_cap_is_loaded_up_to_the_cap() {
    let ca = Ca::new("test root");
    let files = three();
    let mut served = site(&files);
    served.remove(&format!("/repo/profiles/{}.json", files[0].0));
    let fetched = fetch_within(&ca, served.clone(), Budget { entries: 2, ..BUDGET }).await.expect("fetched");
    assert_eq!(ids(&fetched), [files[1].0.as_str()], "a missing file still counts");
    assert_eq!(fetched.skipped.len(), 2);
    assert_eq!(fetched.skipped[1].reason, "the index lists more than 2 files");

    let fetched = fetch_within(&ca, served, Budget { entries: 3, ..BUDGET }).await.expect("fetched");
    assert_eq!(ids(&fetched).len(), 2);
    assert_eq!(fetched.skipped.len(), 1);
}

#[tokio::test]
async fn no_file_is_fetched_once_the_time_budget_is_spent() {
    let ca = Ca::new("test root");
    let files = first_two();
    let none = Budget { time: Duration::ZERO, ..BUDGET };
    let fetched = fetch_within(&ca, site(&files), none).await.expect("fetched");
    assert_eq!(ids(&fetched), [] as [&str; 0]);
    assert!(
        fetched.skipped.iter().all(|s| s.reason == "the source took longer than 0ns"),
        "{:?}",
        fetched.skipped
    );
}

#[tokio::test]
async fn a_stalled_file_is_cut_off_by_the_time_budget_not_the_request_timeout() {
    let ca = Ca::new("test root");
    let files = first_two();
    let stalled = format!("/repo/profiles/{}.json", files[0].0);
    let instead = BTreeMap::from([(stalled, Instead::Stall)]);
    let port = serve_site_with(&ca, site(&files), instead).await;
    let budget = Budget { time: Duration::from_millis(400), ..BUDGET };
    let started = std::time::Instant::now();
    let fetched = fetch(&source(port), limits(), budget, &[ca.root()], |_| false).await.expect("fetched");
    assert!(started.elapsed() < Duration::from_secs(3), "{:?}", started.elapsed());
    assert_eq!(fetched.skipped[0].reason, "timed out");
    assert_eq!(fetched.skipped[1].reason, "the source took longer than 400ms");
}

const SECRET: &str = "SECRET-VALUE";

#[tokio::test]
async fn an_error_about_the_index_never_repeats_what_the_server_sent() {
    let ca = Ca::new("test root");
    for body in [
        format!(r#"{{"profiles": "{SECRET}"}}"#),
        format!(r#"{{"profiles": [{{"id": "{SECRET}", "path": ["{SECRET}"]}}]}}"#),
        format!(r#"{{"profiles": [{{"id": "{SECRET}"}}]}}"#),
        format!(r#"{{"profiles": [], "{SECRET}": }}"#),
    ] {
        let mut files = site(&[]);
        files.insert("/repo/index.json".into(), body.clone().into_bytes());
        let err = fetch_from(&ca, files).await.expect_err("malformed");
        let SourceError::MalformedIndex(text) = &err else { panic!("{body}: {err:?}") };
        assert!(!text.contains(SECRET), "{body}: {text}");
        assert!(!err.to_string().contains(SECRET), "{body}: {err}");
    }
}

#[tokio::test]
async fn a_skip_reason_never_repeats_what_the_server_sent() {
    let ca = Ca::new("test root");
    let files = first_two();
    let mut by_id = vec![];
    for (n, value) in
        [("metrics", json!(SECRET)), ("id", json!([SECRET])), ("name", json!({ SECRET: SECRET }))]
    {
        let mut broken = files[0].1.clone();
        broken[n] = value;
        by_id.push(broken);
    }
    let mut variant = files[0].1.clone();
    variant["metrics"][0]["binding"]["via"] = json!(SECRET);
    by_id.push(variant);
    let mut served = site(&files);
    let path = format!("/repo/profiles/{}.json", files[0].0);
    for broken in by_id {
        served.insert(path.clone(), broken.to_string().into_bytes());
        let fetched = fetch_from(&ca, served.clone()).await.expect("fetched");
        let reason = &fetched.skipped[0].reason;
        assert!(!reason.contains(SECRET), "{broken}: {reason}");
        assert!(reason.starts_with("invalid") || reason.starts_with("unknown"), "{reason}");
    }
    served.insert(path, format!("{SECRET} not json").into_bytes());
    let fetched = fetch_from(&ca, served).await.expect("fetched");
    assert!(!fetched.skipped[0].reason.contains(SECRET), "{:?}", fetched.skipped[0]);
}

#[tokio::test]
async fn an_id_the_index_lists_is_not_repeated_in_a_skip_reason() {
    let ca = Ca::new("test root");
    let files = first_two();
    let mut listing = index_of(&files);
    listing["profiles"][1]["id"] = json!(SECRET);
    let again = listing["profiles"][1].clone();
    listing["profiles"].as_array_mut().expect("array").push(again);
    let mut served = site(&files);
    served.insert("/repo/index.json".into(), listing.to_string().into_bytes());
    let fetched = fetch_from(&ca, served).await.expect("fetched");
    assert_eq!(fetched.skipped.len(), 2);
    assert!(fetched.skipped.iter().all(|s| !s.reason.contains(SECRET)), "{:?}", fetched.skipped);
}

/// Live network: `cargo test -p sunreye --test profile_sources -- --ignored`. The revision the compiled-in
/// set is pinned to, through the repository's raw-file URL.
#[tokio::test]
#[ignore = "needs the internet"]
async fn live_the_official_repository_loads_through_its_raw_file_url() {
    let commit = Bundle::official().expect("bundle").source.commit;
    let source = Source {
        base_url: format!("https://raw.githubusercontent.com/SunReye/SunReye-Official-Profiles/{commit}/"),
        index_path: "index.json".into(),
    };
    let fetched =
        fetch(&source, sunreye::sources::REQUEST_LIMITS, BUDGET, &[], |_| false).await.expect("fetched");
    assert_decodes_the_oracle(&fetched);
}
