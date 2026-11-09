//! Fetching, verifying and serving profiles from an index (ADR 8), against a fake host and keys
//! generated per test.

use std::sync::Arc;
use std::time::UNIX_EPOCH;

use serde_json::{Value, json};

use super::fake::{Host, Signer, entry};
use super::{OFFICIAL_INDEX, Profiles, Report, Status};
use crate::bus::Bus;
use crate::storage::Storage;

const DEYE: &str = include_str!("../../../../profiles/deye-sg05lp3.json");
const COMMUNITY: &str = "https://example.org/profiles/index.json";

/// The bundled Deye at `version`, or as another `id`.
fn deye(id: &str, version: &str) -> Vec<u8> {
    DEYE.replace("\"deye-sg05lp3\"", &format!("\"{id}\""))
        .replace(
            "\"version\": \"2.2.0\"",
            &format!("\"version\": \"{version}\""),
        )
        .into_bytes()
}

fn index(profiles: &[Value]) -> Vec<u8> {
    serde_json::to_vec(&json!({ "profiles": profiles })).unwrap()
}

struct Plant {
    storage: Storage,
    host: Arc<Host>,
    signer: Signer,
    _dir: tempfile::TempDir,
}

impl Plant {
    fn new() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let storage = Storage::open(
            &dir.path().join("core.sqlite"),
            UNIX_EPOCH,
            "UTC",
            &Bus::default(),
        )
        .unwrap();
        Self {
            storage,
            host: Host::new(),
            signer: Signer::default(),
            _dir: dir,
        }
    }

    async fn open(&self) -> Profiles {
        let fetch = Arc::clone(&self.host);
        Profiles::open(self.storage.database(), fetch, Some(self.signer.keys()))
            .await
            .unwrap()
    }

    /// Hosts the official index with `profiles`, each served at its own URL.
    fn official(&self, profiles: &[(&[u8], Option<&ring::signature::Ed25519KeyPair>)]) {
        let entries: Vec<Value> = profiles
            .iter()
            .enumerate()
            .map(|(i, (bytes, by))| {
                let url = format!("https://sunreye.github.io/SunReye/p{i}.json");
                self.host.serve(&url, *bytes);
                entry(bytes, &url, *by)
            })
            .collect();
        self.host.serve(OFFICIAL_INDEX, index(&entries));
    }
}

fn version(profiles: &Profiles, id: &str) -> Option<String> {
    profiles.catalogue().get(id).map(|p| p.version.clone())
}

fn statuses(report: &Report) -> Vec<(String, Status)> {
    report
        .profiles
        .iter()
        .map(|o| (o.id.clone(), o.status))
        .collect()
}

#[tokio::test]
async fn opening_fetches_nothing_and_the_embedded_snapshot_works_offline() {
    let plant = Plant::new();

    let profiles = plant.open().await;
    let reports = profiles.check().await.unwrap();

    assert_eq!(plant.host.fetched(), vec![OFFICIAL_INDEX.to_owned()]);
    assert_eq!(version(&profiles, "deye-sg05lp3").as_deref(), Some("2.2.0"));
    assert!(profiles.catalogue().official("deye-sg05lp3"));
    assert_eq!(reports[0].problem, Some(super::IndexProblem::Unreachable));
}

#[tokio::test]
async fn a_signed_higher_version_replaces_the_bundled_one_and_outlives_a_restart() {
    let plant = Plant::new();
    let newer = deye("deye-sg05lp3", "2.3.0");
    plant.official(&[(&newer, Some(&plant.signer.active))]);
    let profiles = plant.open().await;

    let reports = profiles.check().await.unwrap();

    assert_eq!(
        statuses(&reports[0]),
        vec![("deye-sg05lp3".to_owned(), Status::Loaded)]
    );
    assert_eq!(version(&profiles, "deye-sg05lp3").as_deref(), Some("2.3.0"));
    let fetched = plant.host.fetched().len();
    let reopened = plant.open().await;
    assert_eq!(version(&reopened, "deye-sg05lp3").as_deref(), Some("2.3.0"));
    assert!(reopened.catalogue().official("deye-sg05lp3"));
    assert_eq!(
        plant.host.fetched().len(),
        fetched,
        "a restart fetches nothing"
    );
}

#[tokio::test]
async fn a_version_not_above_the_one_served_is_not_downloaded() {
    let plant = Plant::new();
    let same = deye("deye-sg05lp3", "2.2.0");
    plant.official(&[(&same, Some(&plant.signer.active))]);
    let profiles = plant.open().await;

    let reports = profiles.check().await.unwrap();

    assert_eq!(
        statuses(&reports[0]),
        vec![("deye-sg05lp3".to_owned(), Status::Current)]
    );
    assert_eq!(plant.host.fetched(), vec![OFFICIAL_INDEX.to_owned()]);
}

#[tokio::test]
async fn a_hash_mismatch_is_refused_and_the_last_good_copy_is_served() {
    let plant = Plant::new();
    let newer = deye("deye-sg05lp3", "2.3.0");
    plant.official(&[(&newer, Some(&plant.signer.active))]);
    let tampered = deye("deye-sg05lp3", "2.4.0");
    plant
        .host
        .serve("https://sunreye.github.io/SunReye/p0.json", tampered);
    let profiles = plant.open().await;

    let reports = profiles.check().await.unwrap();

    assert_eq!(
        statuses(&reports[0]),
        vec![("deye-sg05lp3".to_owned(), Status::Hash)]
    );
    assert_eq!(version(&profiles, "deye-sg05lp3").as_deref(), Some("2.2.0"));
}

#[tokio::test]
async fn a_signature_over_other_bytes_cannot_replace_an_official_profile() {
    let plant = Plant::new();
    let newer = deye("deye-sg05lp3", "2.3.0");
    let reformatted: Vec<u8> = [newer.as_slice(), b"\n"].concat();
    let mut listed = entry(
        &reformatted,
        "https://sunreye.github.io/SunReye/p0.json",
        None,
    );
    listed["signature"] = entry(&newer, "", Some(&plant.signer.active))["signature"].clone();
    plant
        .host
        .serve("https://sunreye.github.io/SunReye/p0.json", reformatted);
    plant.host.serve(OFFICIAL_INDEX, index(&[listed]));
    let profiles = plant.open().await;

    let reports = profiles.check().await.unwrap();

    assert_eq!(
        statuses(&reports[0]),
        vec![("deye-sg05lp3".to_owned(), Status::Signature)]
    );
    assert_eq!(version(&profiles, "deye-sg05lp3").as_deref(), Some("2.2.0"));
}

#[tokio::test]
async fn a_revocation_signed_by_the_backup_switches_trust_to_the_backup() {
    let plant = Plant::new();
    let by_active = deye("deye-sg05lp3", "2.3.0");
    plant.official(&[(&by_active, Some(&plant.signer.active))]);
    let profiles = plant.open().await;
    profiles.check().await.unwrap();
    let by_backup = deye("other-inverter", "1.0.0");
    let newer_by_active = deye("deye-sg05lp3", "2.4.0");
    let entries = [
        entry(
            &by_backup,
            "https://sunreye.github.io/SunReye/b.json",
            Some(&plant.signer.backup),
        ),
        entry(
            &newer_by_active,
            "https://sunreye.github.io/SunReye/a.json",
            Some(&plant.signer.active),
        ),
    ];
    plant
        .host
        .serve("https://sunreye.github.io/SunReye/b.json", by_backup);
    plant
        .host
        .serve("https://sunreye.github.io/SunReye/a.json", newer_by_active);
    let revoked = json!({ "profiles": entries,
        "revocation": plant.signer.revocation(&plant.signer.backup) });
    plant
        .host
        .serve(OFFICIAL_INDEX, serde_json::to_vec(&revoked).unwrap());

    let reports = profiles.check().await.unwrap();

    assert_eq!(
        statuses(&reports[0]),
        vec![
            ("other-inverter".to_owned(), Status::Loaded),
            ("deye-sg05lp3".to_owned(), Status::Signature),
        ]
    );
    assert!(profiles.catalogue().official("other-inverter"));
    // The copy the revoked key signed no longer counts as official: the snapshot is served again.
    assert_eq!(version(&profiles, "deye-sg05lp3").as_deref(), Some("2.2.0"));
    plant.host.serve(OFFICIAL_INDEX, index(&[]));
    let reopened = plant.open().await;
    reopened.check().await.unwrap();
    assert_eq!(version(&reopened, "deye-sg05lp3").as_deref(), Some("2.2.0"));
    assert!(reopened.catalogue().official("other-inverter"));
}

#[tokio::test]
async fn a_revocation_the_backup_did_not_sign_is_ignored() {
    let plant = Plant::new();
    let newer = deye("deye-sg05lp3", "2.3.0");
    let url = "https://sunreye.github.io/SunReye/p0.json";
    plant.host.serve(url, newer.clone());
    let forged = json!({ "profiles": [entry(&newer, url, Some(&plant.signer.active))],
        "revocation": plant.signer.revocation(&plant.signer.active) });
    plant
        .host
        .serve(OFFICIAL_INDEX, serde_json::to_vec(&forged).unwrap());
    let profiles = plant.open().await;

    let reports = profiles.check().await.unwrap();

    assert_eq!(
        statuses(&reports[0]),
        vec![("deye-sg05lp3".to_owned(), Status::Loaded)]
    );
}

#[tokio::test]
async fn an_entry_above_the_schema_range_or_needing_a_missing_capability_needs_a_newer_core() {
    let plant = Plant::new();
    let url = "https://sunreye.github.io/SunReye/p0.json";
    let mut future = entry(&deye("future", "1.0.0"), url, Some(&plant.signer.active));
    future["schema"] = json!(sunreye_profile::SUPPORT.schema.max + 1);
    let mut mqtt = entry(&deye("evcc", "1.0.0"), url, Some(&plant.signer.active));
    mqtt["requires"] = json!(["mqtt"]);
    plant.host.serve(OFFICIAL_INDEX, index(&[future, mqtt]));
    let profiles = plant.open().await;

    let reports = profiles.check().await.unwrap();

    assert_eq!(
        statuses(&reports[0]),
        vec![
            ("future".to_owned(), Status::NewerCore),
            ("evcc".to_owned(), Status::NewerCore),
        ]
    );
    assert_eq!(plant.host.fetched(), vec![OFFICIAL_INDEX.to_owned()]);
}

#[tokio::test]
async fn adding_an_index_fetches_it_and_its_unsigned_profiles_load_as_community() {
    let plant = Plant::new();
    let custom = deye("my-inverter", "0.1.0");
    let url = "https://example.org/profiles/mine.json";
    plant.host.serve(url, custom.clone());
    plant
        .host
        .serve(COMMUNITY, index(&[entry(&custom, "mine.json", None)]));
    let profiles = plant.open().await;

    let report = profiles
        .add(COMMUNITY.to_owned(), UNIX_EPOCH)
        .await
        .unwrap();

    assert_eq!(
        plant.host.fetched(),
        vec![COMMUNITY.to_owned(), url.to_owned()]
    );
    assert_eq!(
        statuses(&report),
        vec![("my-inverter".to_owned(), Status::Loaded)]
    );
    assert_eq!(version(&profiles, "my-inverter").as_deref(), Some("0.1.0"));
    assert!(!profiles.catalogue().official("my-inverter"));
    let listed: Vec<String> = profiles
        .indexes()
        .await
        .unwrap()
        .into_iter()
        .map(|r| r.url)
        .collect();
    assert_eq!(
        listed,
        vec![OFFICIAL_INDEX.to_owned(), COMMUNITY.to_owned()]
    );
}

#[tokio::test]
async fn a_community_profile_never_replaces_an_official_one() {
    let plant = Plant::new();
    let impostor = deye("deye-sg05lp3", "9.0.0");
    let url = "https://example.org/profiles/deye.json";
    plant.host.serve(url, impostor.clone());
    plant
        .host
        .serve(COMMUNITY, index(&[entry(&impostor, url, None)]));
    let profiles = plant.open().await;

    let report = profiles
        .add(COMMUNITY.to_owned(), UNIX_EPOCH)
        .await
        .unwrap();

    assert_eq!(
        statuses(&report),
        vec![("deye-sg05lp3".to_owned(), Status::Signature)]
    );
    assert_eq!(version(&profiles, "deye-sg05lp3").as_deref(), Some("2.2.0"));
}
