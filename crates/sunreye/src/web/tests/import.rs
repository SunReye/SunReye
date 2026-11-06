//! Archive import over HTTP: the upload bound, the automation guard and one import at a time. Golden values
//! are the oracle archives' (`fixtures/oracle/archives`); the sha256 is `sha256sum archive.tar.gz`.

use super::*;
use crate::web::import::{UPLOAD_FILE, UploadLimit};

const CURRENT_SHA256: &str = "cc05db473ae491d3495ed10ad78c23625b85931404c2d347742e428e06a4802d";
const LEGACY_SHA256: &str = "85746cda38de3bb4ff57279fb70aa76a6243bf83c24bf5bc88c80481764a102e";
const UPLOAD: &str = "/api/admin/import";
const CONFIRM: &str = "/api/admin/import/confirm";

fn archives() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/oracle/archives")
}

fn archive(case: &str) -> Vec<u8> {
    std::fs::read(archives().join(case).join("archive.tar.gz")).expect("archive")
}

/// `manifest.json`'s `createdAt`, 2026-05-02T00:00:00Z: the clock the archives were cut at.
const fn created() -> i64 {
    1_777_680_000_000
}

/// A signed-in core on the archives' clock that polls nothing: imported devices name hosts on other LANs.
async fn importer(name: &str, limit: UploadLimit) -> (Arc<Core>, Api) {
    let core = Core::open_unpolled(&dir(name), created).await.expect("core");
    signed_in(core, &Config { upload_limit: limit, ..Config::default() }).await
}

async fn upload_to(api: &Api, path: &str, bytes: Vec<u8>) -> Answer {
    let mut request = Request::builder()
        .method(Method::POST)
        .uri(path)
        .header(header::HOST, HOST)
        .header(header::ORIGIN, SAME_ORIGIN)
        .header(header::CONTENT_TYPE, "application/gzip")
        .header("x-confirm", CURRENT_SHA256);
    if let Some(cookie) = &api.cookie {
        request = request.header(header::COOKIE, cookie);
    }
    answer(
        api.router
            .clone()
            .oneshot(request.body(Body::from(bytes)).expect("request"))
            .await
            .expect("response"),
    )
    .await
}

async fn upload(api: &Api, bytes: Vec<u8>) -> Answer {
    upload_to(api, UPLOAD, bytes).await
}

async fn confirm(api: &Api, sha256: &str) -> Answer {
    post(api, CONFIRM, &json!({"sha256": sha256})).await
}

async fn devices(core: &Core) -> usize {
    core.store.devices().await.expect("devices").len()
}

/// What `expected-import.json` says landed: rows read per stream and the partial days left out.
fn expected(case: &str, device: &str) -> (Value, Value) {
    let text = std::fs::read_to_string(archives().join(case).join("expected-import.json")).expect("expected");
    let want: Value = serde_json::from_str(&text).expect("json");
    let gaps: Vec<Value> = want["result"]["replays"][0]["gaps"]
        .as_array()
        .expect("gaps")
        .iter()
        .map(|g| json!({"device": device, "start": g["start"], "end": g["end"]}))
        .collect();
    (want["result"]["inserted"].clone(), Value::Array(gaps))
}

fn assert_imported(answer: &Answer, case: &str, device: &str) {
    assert_eq!(answer.status, StatusCode::OK, "{:?}", answer.json());
    let (read, gaps) = expected(case, device);
    let got = answer.json();
    assert_eq!((&got["read"], &got["gaps"]), (&read, &gaps));
    assert_eq!((&got["conflicts"], &got["firstConflict"]), (&json!(0), &Value::Null));
}

const NOT_HELD: &str = "No upload awaits confirmation for that archive: upload it again";

#[tokio::test]
async fn an_archive_with_automation_stops_at_the_guard_and_its_sha256_continues_it() {
    let (core, admin) = importer("import-guard", UploadLimit::default()).await;
    let guarded = upload(&admin, archive("current-2.x")).await;
    assert_eq!(guarded.status, StatusCode::ACCEPTED);
    assert_eq!(
        guarded.json(),
        json!({"sha256": CURRENT_SHA256,
               "held": [{"key": "1:peak-shaving", "value": 60.0, "capturedAt": "2026-05-01T10:00:00.000Z"}]})
    );
    assert_eq!(devices(&core).await, 0, "the guard writes nothing");
    assert_imported(&confirm(&admin, CURRENT_SHA256).await, "current-2.x", "oracle-archive-inverter");
    assert_eq!(devices(&core).await, 1);
    drop(admin);
    core.stop().await;
}

#[tokio::test]
async fn a_flag_a_second_upload_or_another_archives_sha256_does_not_pass_the_guard() {
    let (core, admin) = importer("import-guard-skips", UploadLimit::default()).await;
    let flagged = format!("{UPLOAD}?confirm=true&confirmed=true&sha256={CURRENT_SHA256}");
    assert_eq!(upload_to(&admin, &flagged, archive("current-2.x")).await.status, StatusCode::ACCEPTED);
    assert_eq!(upload(&admin, archive("current-2.x")).await.status, StatusCode::ACCEPTED);
    assert_eq!(devices(&core).await, 0);
    for other in [LEGACY_SHA256, "", &CURRENT_SHA256.to_uppercase()] {
        let refused = confirm(&admin, other).await;
        assert_eq!(
            (refused.status, refused.json()["error"].clone()),
            (StatusCode::CONFLICT, json!(NOT_HELD))
        );
    }
    assert_eq!(post(&admin, CONFIRM, &json!({"confirmed": true})).await.status, StatusCode::BAD_REQUEST);
    assert_eq!(devices(&core).await, 0);
    assert_eq!(confirm(&admin, CURRENT_SHA256).await.status, StatusCode::OK, "the held upload still waits");
    drop(admin);
    core.stop().await;
}

#[tokio::test]
async fn a_confirmation_is_single_use() {
    let (core, admin) = importer("import-replay", UploadLimit::default()).await;
    assert_eq!(upload(&admin, archive("current-2.x")).await.status, StatusCode::ACCEPTED);
    assert_eq!(confirm(&admin, CURRENT_SHA256).await.status, StatusCode::OK);
    let replayed = confirm(&admin, CURRENT_SHA256).await;
    assert_eq!((replayed.status, replayed.json()["error"].clone()), (StatusCode::CONFLICT, json!(NOT_HELD)));
    drop(admin);
    core.stop().await;
}

#[tokio::test]
async fn a_confirmation_held_in_memory_does_not_survive_a_restart() {
    let dir = dir("import-restart");
    let core = Core::open_unpolled(&dir, created).await.expect("core");
    let (core, admin) = signed_in(core, &Config::default()).await;
    assert_eq!(upload(&admin, archive("current-2.x")).await.status, StatusCode::ACCEPTED);
    drop(admin);
    core.stop().await;
    let core = Core::open_unpolled(&dir, created).await.expect("core");
    let (core, admin) = signed_in(core, &Config::default()).await;
    assert!(!dir.join(UPLOAD_FILE).exists(), "the held upload is removed at start");
    assert_eq!(confirm(&admin, CURRENT_SHA256).await.status, StatusCode::CONFLICT);
    assert_eq!(devices(&core).await, 0);
    drop(admin);
    core.stop().await;
}

#[tokio::test]
async fn an_archive_without_automation_imports_on_upload() {
    let (core, admin) = importer("import-legacy", UploadLimit::default()).await;
    let profile = json!({"id": "oracle-legacy-profile", "name": "Oracle legacy", "manufacturer": "Oracle",
                         "version": "1.0.17", "metrics": []});
    assert_eq!(import(&admin, &profile).await.status, StatusCode::OK);
    assert_imported(&upload(&admin, archive("legacy-1.2.0")).await, "legacy-1.2.0", "oracle-legacy-profile");
    assert_eq!(devices(&core).await, 1);
    let again = upload(&admin, archive("legacy-1.2.0")).await;
    assert_eq!(again.status, StatusCode::CONFLICT, "the store holds devices now");
    drop(admin);
    core.stop().await;
}

#[tokio::test]
async fn an_upload_of_the_limit_is_read_and_one_byte_more_is_a_413_that_writes_nothing() {
    let bytes = archive("current-2.x");
    let size = bytes.len() as u64;
    let (core, admin) = importer("import-limit", UploadLimit(size)).await;
    assert_eq!(upload(&admin, bytes.clone()).await.status, StatusCode::ACCEPTED);
    drop(admin);
    core.stop().await;

    let dir = dir("import-over");
    let core = Core::open_unpolled(&dir, created).await.expect("core");
    let (core, admin) =
        signed_in(core, &Config { upload_limit: UploadLimit(size - 1), ..Config::default() }).await;
    let over = upload(&admin, bytes).await;
    assert_eq!(over.status, StatusCode::PAYLOAD_TOO_LARGE);
    assert_eq!(over.json(), json!({"error": format!("An archive is at most {} bytes", size - 1)}));
    assert!(!dir.join(UPLOAD_FILE).exists(), "the partial upload is removed");
    assert_eq!(confirm(&admin, CURRENT_SHA256).await.status, StatusCode::CONFLICT);
    assert_eq!(devices(&core).await, 0);
    drop(admin);
    core.stop().await;
}

#[test]
fn the_upload_limit_is_512_mib() {
    assert_eq!(UploadLimit::default(), UploadLimit(512 << 20));
}

#[tokio::test]
async fn an_upload_past_the_default_body_limit_is_read_whole() {
    let (core, admin) = importer("import-large", UploadLimit::default()).await;
    let refused = upload(&admin, vec![0; 3 << 20]).await;
    assert_eq!(refused.status, StatusCode::BAD_REQUEST, "read to the end, not cut at 2 MiB");
    assert!(refused.json()["error"].as_str().expect("error").starts_with("archive: "));
    drop(admin);
    core.stop().await;
}

#[tokio::test]
async fn while_an_import_runs_no_other_import_starts_and_no_device_is_added() {
    let (core, admin) = importer("import-serial", UploadLimit::default()).await;
    put(&admin, "/api/settings/active-profile", &json!({"id": PROFILE})).await;
    let running = core.imports.try_lock().expect("free");
    let busy = upload(&admin, archive("current-2.x")).await;
    assert_eq!((busy.status, busy.json()["error"].clone()), (StatusCode::CONFLICT, json!(RUNNING)));
    assert_eq!(confirm(&admin, CURRENT_SHA256).await.status, StatusCode::CONFLICT);
    let device = json!({"connection": {"create": {"name": "Meter", "kind": "modbus",
                                                  "params": {"host": "127.0.0.1", "port": 9}}},
                        "role": "meter", "name": "Meter", "profileId": PROFILE, "unitId": 1});
    let added = post(&admin, "/api/devices", &device).await;
    assert_eq!((added.status, added.json()["error"].clone()), (StatusCode::CONFLICT, json!(RUNNING)));
    let saved = put(&admin, "/api/settings/inverter", &connection(9)).await;
    assert_eq!((saved.status, saved.json()["error"].clone()), (StatusCode::CONFLICT, json!(RUNNING)));
    assert_eq!(devices(&core).await, 0);
    drop(running);
    assert_eq!(post(&admin, "/api/devices", &device).await.status, StatusCode::OK);
    drop(admin);
    core.stop().await;
}

const RUNNING: &str = "An archive import is running: try again when it ends";
