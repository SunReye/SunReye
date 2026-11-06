//! Archive import over HTTP: the upload bound, the automation guard and one import at a time. Golden values
//! are the oracle archives' (`fixtures/oracle/archives`); the sha256 is `sha256sum archive.tar.gz`.

use std::collections::BTreeSet;

use futures_util::StreamExt as _;
use futures_util::stream;
use tokio::sync::oneshot;

use super::users::signed_in_user;
use super::*;
use crate::archive::testing::{gz, tar};
use crate::modbus::Transport;
use crate::run::{Fault, Pause};
use crate::store::{NewConnection, NewDevice};
use crate::web::import::{PART_FILE, REAPPLY, UPLOAD_FILE, UploadDeadline, UploadIdle, UploadLimit};

const CURRENT_SHA256: &str = "cc05db473ae491d3495ed10ad78c23625b85931404c2d347742e428e06a4802d";
const LEGACY_SHA256: &str = "85746cda38de3bb4ff57279fb70aa76a6243bf83c24bf5bc88c80481764a102e";
const UPLOAD: &str = "/api/admin/import";
const CONFIRM: &str = "/api/admin/import/confirm";
const DISCARD: &str = "/api/admin/import/discard";

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

fn upload_request(api: &Api, path: &str, length: Option<u64>, body: Body) -> Request<Body> {
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
    if let Some(length) = length {
        request = request.header(header::CONTENT_LENGTH, length);
    }
    request.body(body).expect("request")
}

async fn send_upload(api: &Api, length: Option<u64>, body: Body) -> Answer {
    let request = upload_request(api, UPLOAD, length, body);
    answer(api.router.clone().oneshot(request).await.expect("response")).await
}

async fn upload_to(api: &Api, path: &str, bytes: Vec<u8>) -> Answer {
    let request = upload_request(api, path, None, Body::from(bytes));
    answer(api.router.clone().oneshot(request).await.expect("response")).await
}

async fn upload(api: &Api, bytes: Vec<u8>) -> Answer {
    upload_to(api, UPLOAD, bytes).await
}

async fn confirm(api: &Api, sha256: &str) -> Answer {
    post(api, CONFIRM, &json!({"sha256": sha256})).await
}

async fn discard(api: &Api, sha256: &str) -> Answer {
    post(api, DISCARD, &json!({"sha256": sha256})).await
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
    assert_eq!(got["pollingError"], Value::Null);
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
async fn an_imported_plant_is_set_up_with_its_first_devices_profile() {
    let (core, admin) = importer("import-profile", UploadLimit::default()).await;
    assert_eq!(
        get(&admin, "/api/profile-status").await.json(),
        json!({"needsProfile": true, "activeProfileId": null})
    );
    assert_eq!(upload(&admin, archive("current-2.x")).await.status, StatusCode::ACCEPTED);
    assert_eq!(
        get(&admin, "/api/profile-status").await.json()["needsProfile"],
        true,
        "the guard writes nothing"
    );
    assert_eq!(confirm(&admin, CURRENT_SHA256).await.status, StatusCode::OK);
    assert_eq!(
        get(&admin, "/api/profile-status").await.json(),
        json!({"needsProfile": false, "activeProfileId": "deye-sg05lp3"})
    );
    let roster = get(&admin, "/api/devices").await.json();
    assert_eq!(roster["devices"][0]["unitId"], 1, "the archive's unit id stands");
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
    let dir = dir("import-guard-restart");
    let core = Core::open_unpolled(&dir, created).await.expect("core");
    let (core, admin) = signed_in(core, &Config::default()).await;
    assert_eq!(upload(&admin, archive("current-2.x")).await.status, StatusCode::ACCEPTED);
    drop(admin);
    core.stop().await;
    std::fs::write(dir.join(PART_FILE), b"cut off by a crash").expect("part");
    let core = Core::open_unpolled(&dir, created).await.expect("core");
    let (core, admin) = signed_in(core, &Config::default()).await;
    assert!(!dir.join(UPLOAD_FILE).exists(), "the held upload is removed at start");
    assert!(!dir.join(PART_FILE).exists(), "an upload a crash cut off is removed at start");
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
    let (core, admin) = importer("import-archive-large", UploadLimit::default()).await;
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

/// `current-2.x`'s members with `config` as `config.json` and `then` after it.
fn crafted(config: &[u8], then: &[(&str, Vec<u8>)]) -> Vec<u8> {
    let loose = |name: &str| std::fs::read(archives().join("current-2.x").join(name)).expect("member");
    let mut members = vec![("manifest.json", loose("manifest.json")), ("config.json", config.to_vec())];
    members.extend(then.iter().cloned());
    members.push(("config-log.ndjson.gz", gz(&loose("config-log.ndjson"))));
    members.push(("readings.ndjson.gz", gz(&loose("readings.ndjson"))));
    gz(&tar(&members))
}

#[tokio::test]
async fn an_archive_repeating_config_json_is_refused_whichever_copy_holds_automation() {
    let (core, admin) = importer("import-repeated", UploadLimit::default()).await;
    let on = std::fs::read(archives().join("current-2.x").join("config.json")).expect("config");
    let mut off: Value = serde_json::from_slice(&on).expect("json");
    off.as_object_mut().expect("object").remove("appSettings");
    let off = off.to_string().into_bytes();
    let refused = |answer: &Answer, name: &str| {
        assert_eq!(
            (answer.status, answer.json()["error"].clone()),
            (StatusCode::BAD_REQUEST, json!(format!("{name}: repeated in the archive")))
        );
    };
    refused(&upload(&admin, crafted(&off, &[("config.json", on.clone())])).await, "config.json");
    refused(&upload(&admin, crafted(&on, &[("config.json", off.clone())])).await, "config.json");
    refused(&upload(&admin, crafted(&off, &[("./config.json", on.clone())])).await, "./config.json");
    refused(&upload(&admin, crafted(&off, &[("Config.JSON", on.clone())])).await, "Config.JSON");
    let whole = tar(&[("config.json", off.clone()), ("config.json", on.clone())]);
    let cut = gz(&whole[..whole.len() - 1024 - 512]);
    refused(&upload(&admin, cut).await, "config.json");
    assert_eq!(devices(&core).await, 0);
    assert!(!core.upload.exists());
    assert_eq!(upload(&admin, crafted(&off, &[])).await.status, StatusCode::OK, "one copy imports");
    drop(admin);
    core.stop().await;
}

/// `current-2.x` held at the guard, its file as uploaded.
async fn held(api: &Api, core: &Core) {
    assert_eq!(upload(api, archive("current-2.x")).await.status, StatusCode::ACCEPTED);
    assert_eq!(std::fs::read(&core.upload).expect("held"), archive("current-2.x"));
}

fn assert_413(answer: &Answer, limit: u64) {
    assert_eq!(
        (answer.status, answer.json()),
        (StatusCode::PAYLOAD_TOO_LARGE, json!({"error": format!("An archive is at most {limit} bytes")}))
    );
}

#[tokio::test]
async fn a_declared_length_over_the_limit_is_a_413_that_leaves_the_held_upload() {
    let limit = archive("current-2.x").len() as u64;
    let (core, admin) = importer("import-declared", UploadLimit(limit)).await;
    held(&admin, &core).await;
    let small = Body::from(archive("legacy-1.2.0")[..10].to_vec());
    assert_413(&send_upload(&admin, Some(limit + 1), small).await, limit);
    assert_eq!(std::fs::read(&core.upload).expect("held"), archive("current-2.x"));
    assert_eq!(
        send_upload(&admin, Some(limit), Body::from(archive("current-2.x"))).await.status,
        StatusCode::ACCEPTED
    );
    assert_eq!(confirm(&admin, CURRENT_SHA256).await.status, StatusCode::OK);
    drop(admin);
    core.stop().await;
}

#[tokio::test]
async fn a_body_longer_than_its_declared_length_is_a_413_that_leaves_the_held_upload() {
    let limit = archive("current-2.x").len() as u64;
    let (core, admin) = importer("import-lying", UploadLimit(limit)).await;
    held(&admin, &core).await;
    let longer = Body::from(vec![0; usize::try_from(limit).expect("size") + 1]);
    let before = entries(&core);
    assert_413(&send_upload(&admin, Some(10), longer).await, limit);
    assert_eq!(std::fs::read(&core.upload).expect("held"), archive("current-2.x"));
    assert_eq!(entries(&core), before, "nothing is left beside the held upload");
    assert_eq!(confirm(&admin, CURRENT_SHA256).await.status, StatusCode::OK);
    drop(admin);
    core.stop().await;
}

/// The names in the data directory.
fn entries(core: &Core) -> BTreeSet<String> {
    let dir = std::fs::read_dir(core.upload.parent().expect("dir")).expect("dir");
    dir.map(|e| e.expect("entry").file_name().to_string_lossy().into_owned()).collect()
}

#[tokio::test]
async fn a_new_upload_that_is_refused_ends_the_wait_of_the_one_before() {
    let (core, admin) = importer("import-replaced", UploadLimit::default()).await;
    held(&admin, &core).await;
    assert_eq!(upload(&admin, vec![0; 64]).await.status, StatusCode::BAD_REQUEST);
    let ended = confirm(&admin, CURRENT_SHA256).await;
    assert_eq!((ended.status, ended.json()["error"].clone()), (StatusCode::CONFLICT, json!(NOT_HELD)));
    assert!(!core.upload.exists());
    drop(admin);
    core.stop().await;
}

#[tokio::test]
async fn a_held_upload_changed_on_disk_is_not_imported() {
    let (core, admin) = importer("import-changed", UploadLimit::default()).await;
    held(&admin, &core).await;
    std::fs::write(&core.upload, archive("legacy-1.2.0")).expect("overwrite");
    let changed = confirm(&admin, CURRENT_SHA256).await;
    assert_eq!(
        (changed.status, changed.json()["error"].clone()),
        (StatusCode::CONFLICT, json!("The held upload changed: upload it again"))
    );
    assert!(!core.upload.exists());
    assert_eq!(devices(&core).await, 0);
    drop(admin);
    core.stop().await;
}

/// The first 100 bytes of `current-2.x`, then nothing: a client that stopped sending.
fn stalled() -> Body {
    let first = archive("current-2.x")[..100].to_vec();
    let chunks = stream::iter([Ok::<_, std::io::Error>(first)]).chain(stream::pending());
    Body::from_stream(chunks)
}

#[tokio::test]
async fn a_stalled_upload_is_a_408_that_frees_the_import_and_leaves_the_held_upload() {
    let core = Core::open_unpolled(&dir("import-stalled"), created).await.expect("core");
    let (core, admin) =
        signed_in(core, &Config { upload_idle: UploadIdle(Duration::ZERO), ..Config::default() }).await;
    held(&admin, &core).await;
    let before = entries(&core);
    let stalled = tokio::time::timeout(Duration::from_secs(30), send_upload(&admin, None, stalled()))
        .await
        .expect("the idle bound answers");
    assert_eq!(
        (stalled.status, stalled.json()["error"].clone()),
        (StatusCode::REQUEST_TIMEOUT, json!("The upload stalled: send the archive again"))
    );
    assert_eq!(entries(&core), before, "nothing is left beside the held upload");
    assert!(core.imports.try_lock().is_ok(), "the import lock is free");
    assert_eq!(confirm(&admin, CURRENT_SHA256).await.status, StatusCode::OK);
    drop(admin);
    core.stop().await;
}

#[tokio::test]
async fn a_request_dropped_before_the_guard_check_leaves_nothing_behind_and_frees_the_import() {
    let (core, admin) = importer("import-dropped", UploadLimit::default()).await;
    held(&admin, &core).await;
    let before = entries(&core);
    let request = upload_request(&admin, UPLOAD, None, stalled());
    let running = tokio::spawn(admin.router.clone().oneshot(request));
    tokio::time::timeout(Duration::from_secs(30), async {
        while core.imports.try_lock().is_ok() || entries(&core) == before {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("the upload is being received");
    running.abort();
    assert!(running.await.expect_err("dropped").is_cancelled());
    assert_eq!(entries(&core), before, "nothing is left beside the held upload");
    assert!(core.imports.try_lock().is_ok(), "the import lock is free");
    assert_eq!(devices(&core).await, 0);
    assert_eq!(confirm(&admin, CURRENT_SHA256).await.status, StatusCode::OK);
    drop(admin);
    core.stop().await;
}

#[test]
fn an_upload_may_pause_a_minute_between_chunks() {
    assert_eq!(UploadIdle::default(), UploadIdle(Duration::from_secs(60)));
}

/// Sets a core's pause: the receiver resolves once an import waits there; the sender resumes it.
fn pause(at: &std::sync::Mutex<Option<Pause>>) -> (oneshot::Receiver<()>, oneshot::Sender<()>) {
    let (reached, waiting) = oneshot::channel();
    let (resume, resumed) = oneshot::channel();
    *at.lock().expect("pause") = Some((reached, resumed));
    (waiting, resume)
}

fn applied(core: &Core) -> usize {
    core.seams.events.lock().expect("events").iter().filter(|e| **e == "apply").count()
}

/// `legacy-1.2.0`'s profile, so the archive imports on upload.
async fn legacy_profile(admin: &Api) {
    let profile = json!({"id": "oracle-legacy-profile", "name": "Oracle legacy", "manufacturer": "Oracle",
                         "version": "1.0.17", "metrics": []});
    assert_eq!(import(admin, &profile).await.status, StatusCode::OK);
}

#[tokio::test]
async fn a_request_dropped_while_its_import_runs_still_lands_and_polls_what_it_added() {
    let (core, admin) = importer("import-abandoned", UploadLimit::default()).await;
    legacy_profile(&admin).await;
    let before = applied(&core);
    let (reached, resume) = pause(&core.seams.import_pause);
    let request = upload_request(&admin, UPLOAD, None, Body::from(archive("legacy-1.2.0")));
    let running = tokio::spawn(admin.router.clone().oneshot(request));
    reached.await.expect("the import runs");
    running.abort();
    assert!(running.await.expect_err("dropped").is_cancelled());
    resume.send(()).expect("the import waits");
    drop(core.imports.lock().await);
    assert_eq!(devices(&core).await, 1, "the import landed");
    assert_eq!(applied(&core), before + 1, "what it added is polled");
    assert!(!core.upload.exists(), "the upload is removed");
    assert!(core.imports.try_lock().is_ok(), "the import lock is free");
    drop(admin);
    core.stop().await;
}

#[tokio::test]
async fn an_import_that_panics_is_a_500_that_frees_the_import_and_removes_the_upload() {
    let (core, admin) = importer("import-panics", UploadLimit::default()).await;
    legacy_profile(&admin).await;
    let (_reached, resume) = pause(&core.seams.import_pause);
    drop(resume);
    let failed = upload(&admin, archive("legacy-1.2.0")).await;
    assert_eq!(failed.status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(devices(&core).await, 0);
    assert!(!core.upload.exists(), "the upload is removed");
    assert!(core.imports.try_lock().is_ok(), "the import lock is free");
    assert_eq!(upload(&admin, archive("legacy-1.2.0")).await.status, StatusCode::OK, "the next import runs");
    drop(admin);
    core.stop().await;
}

/// Bytes that never stop and never stall: each 1 KiB chunk follows a yield.
fn trickle() -> Body {
    let chunks = stream::repeat_with(|| vec![0_u8; 1024]).then(|chunk| async {
        tokio::task::yield_now().await;
        Ok::<_, std::io::Error>(chunk)
    });
    Body::from_stream(chunks)
}

#[tokio::test]
async fn an_upload_still_arriving_at_its_deadline_is_a_408_that_frees_the_import() {
    let limit = UploadLimit(1 << 20);
    let config = |deadline| Config { upload_limit: limit, upload_deadline: deadline, ..Config::default() };
    let core = Core::open_unpolled(&dir("import-deadline"), created).await.expect("core");
    let (core, admin) = signed_in(core, &config(UploadDeadline(Duration::ZERO))).await;
    let late = send_upload(&admin, None, trickle()).await;
    assert_eq!(
        (late.status, late.json()["error"].clone()),
        (StatusCode::REQUEST_TIMEOUT, json!("The upload is too slow: send the archive again"))
    );
    assert!(core.imports.try_lock().is_ok(), "the import lock is free");
    drop(admin);
    core.stop().await;

    let core = Core::open_unpolled(&dir("import-in-time"), created).await.expect("core");
    let (core, admin) = signed_in(core, &config(UploadDeadline::default())).await;
    assert_413(&send_upload(&admin, None, trickle()).await, limit.0);
    drop(admin);
    core.stop().await;
}

#[test]
fn an_upload_may_take_two_hours() {
    assert_eq!(UploadDeadline::default(), UploadDeadline(Duration::from_hours(2)));
}

/// Starts a `legacy-1.2.0` upload, waits until its import reaches `at`, then drops the request.
async fn drop_at(admin: &Api, at: &std::sync::Mutex<Option<Pause>>) -> oneshot::Sender<()> {
    let (reached, resume) = pause(at);
    let request = upload_request(admin, UPLOAD, None, Body::from(archive("legacy-1.2.0")));
    let running = tokio::spawn(admin.router.clone().oneshot(request));
    reached.await.expect("the import runs");
    running.abort();
    assert!(running.await.expect_err("dropped").is_cancelled());
    resume
}

#[tokio::test]
async fn a_second_upload_while_a_dropped_requests_import_runs_is_a_409() {
    let (core, admin) = importer("import-dropped-busy", UploadLimit::default()).await;
    legacy_profile(&admin).await;
    let resume = drop_at(&admin, &core.seams.import_pause).await;
    let busy = upload(&admin, archive("legacy-1.2.0")).await;
    assert_eq!((busy.status, busy.json()["error"].clone()), (StatusCode::CONFLICT, json!(RUNNING)));
    resume.send(()).expect("the import waits");
    drop(core.imports.lock().await);
    assert_eq!(devices(&core).await, 1, "the first import landed");
    drop(admin);
    core.stop().await;
}

#[tokio::test]
async fn stopping_the_core_waits_for_a_dropped_requests_import_then_stops_polling_and_closes_the_store() {
    let path = dir("import-dropped-stop");
    let core = Core::open_unpolled(&path, created).await.expect("core");
    let (core, admin) = signed_in(core, &Config::default()).await;
    legacy_profile(&admin).await;
    let seams = Arc::clone(&core.seams);
    let before = seams.events.lock().expect("events").len();
    let resume = drop_at(&admin, &core.seams.apply_pause).await;
    assert_eq!(devices(&core).await, 1, "the import committed");
    drop(admin);

    let stopping = tokio::spawn(core.stop());
    settle().await;
    assert!(!stopping.is_finished(), "stop waits for the import");
    resume.send(()).expect("the import waits");
    stopping.await.expect("stopped");

    assert_eq!(seams.events.lock().expect("events")[before..], ["apply", "polling stopped", "store closed"]);
    let store = Store::open(&path).await.expect("the store reopens");
    assert_eq!(store.devices().await.expect("devices").len(), 1);
    store.close().await;
}

/// Lets every task that can run, run.
async fn settle() {
    for _ in 0..1000 {
        tokio::task::yield_now().await;
    }
}

/// Uploads `legacy-1.2.0`, running `committed` once the import has committed, before it polls.
async fn upload_then(core: &Core, admin: &Api, committed: impl FnOnce()) -> Answer {
    let (reached, resume) = pause(&core.seams.apply_pause);
    let request = upload_request(admin, UPLOAD, None, Body::from(archive("legacy-1.2.0")));
    let answering = tokio::spawn(admin.router.clone().oneshot(request));
    reached.await.expect("the import committed");
    committed();
    resume.send(()).expect("the import waits");
    answer(answering.await.expect("answered").expect("response")).await
}

#[tokio::test]
async fn an_import_whose_polling_fails_answers_the_failure_and_polls_on_the_next_try() {
    for (fault, error) in
        [(Fault::Fail, "stored setting is out of range"), (Fault::Panic, "polling panicked")]
    {
        let (core, admin) = importer("import-apply-fails", UploadLimit::default()).await;
        legacy_profile(&admin).await;
        let before = applied(&core);
        core.seams.apply_faults.lock().expect("faults").push_back(fault);
        // Paused before the retry is armed, time moves only while every task waits on a timer.
        let answer = upload_then(&core, &admin, || tokio::time::pause()).await;
        assert_eq!((answer.status, answer.json()["pollingError"].clone()), (StatusCode::OK, json!(error)));
        assert_eq!(applied(&core), before, "not polled yet");

        tokio::time::sleep(REAPPLY.checked_sub(Duration::from_secs(1)).expect("over a second")).await;
        settle().await;
        assert_eq!(applied(&core), before, "not polled again before {REAPPLY:?}");
        tokio::time::sleep(Duration::from_secs(1)).await;
        settle().await;
        tokio::time::resume();
        assert_eq!(applied(&core), before + 1, "polled without a restart");
        assert_eq!(devices(&core).await, 1);
        assert!(core.imports.try_lock().is_ok(), "the import lock is free");
        drop(admin);
        core.stop().await;
    }
}

#[test]
fn polling_an_import_is_retried_every_ten_seconds() {
    assert_eq!(REAPPLY, Duration::from_secs(10));
}

#[tokio::test]
async fn stopping_the_core_ends_the_retries_of_an_import_whose_polling_keeps_failing() {
    let (core, admin) = importer("import-apply-keeps-failing", UploadLimit::default()).await;
    legacy_profile(&admin).await;
    core.seams.apply_faults.lock().expect("faults").extend([Fault::Fail, Fault::Fail, Fault::Fail]);
    // A retry that ignored the stop would run at once and take the next fault.
    let answer = upload_then(&core, &admin, || tokio::time::pause()).await;
    assert_eq!(answer.json()["pollingError"], json!("stored setting is out of range"));
    let seams = Arc::clone(&core.seams);
    drop(admin);
    core.stop().await;
    tokio::time::resume();
    assert_eq!(seams.apply_faults.lock().expect("faults").len(), 2, "no retry once stopping");
    assert_eq!(seams.events.lock().expect("events").last(), Some(&"store closed"));
}

fn error(answer: &Answer) -> (StatusCode, Value) {
    (answer.status, answer.json()["error"].clone())
}

const NOT_EMPTY: &str = "the store already holds devices: import into a new store";

#[tokio::test]
async fn an_upload_into_a_store_holding_devices_is_a_409_before_any_guard_and_holds_nothing() {
    let (core, admin) = importer("import-not-empty", UploadLimit::default()).await;
    legacy_profile(&admin).await;
    assert_eq!(upload(&admin, archive("legacy-1.2.0")).await.status, StatusCode::OK);
    for bytes in [archive("current-2.x"), archive("legacy-1.2.0")] {
        let refused = upload(&admin, bytes).await;
        assert_eq!(error(&refused), (StatusCode::CONFLICT, json!(NOT_EMPTY)));
        let part = core.upload.with_file_name(PART_FILE);
        assert!(!core.upload.exists() && !part.exists(), "no file is held, no part is left");
        assert!(core.imports.try_lock().expect("free").is_none(), "no guard is raised");
    }
    assert_eq!(error(&confirm(&admin, CURRENT_SHA256).await), (StatusCode::CONFLICT, json!(NOT_HELD)));
    assert_eq!(devices(&core).await, 1);
    drop(admin);
    core.stop().await;
}

#[tokio::test]
async fn discarding_the_held_upload_removes_its_file_and_a_later_confirmation_finds_none() {
    let (core, admin) = importer("import-discard", UploadLimit::default()).await;
    held(&admin, &core).await;
    for other in [LEGACY_SHA256, "", &CURRENT_SHA256.to_uppercase()] {
        let refused = discard(&admin, other).await;
        assert_eq!(error(&refused), (StatusCode::CONFLICT, json!(NOT_HELD)));
        assert!(core.upload.exists(), "another sha256 leaves the held upload");
    }
    assert_eq!(post(&admin, DISCARD, &json!({"confirmed": true})).await.status, StatusCode::BAD_REQUEST);
    let discarded = discard(&admin, CURRENT_SHA256).await;
    assert_eq!(discarded.status, StatusCode::NO_CONTENT);
    assert!(!core.upload.exists(), "the held file is removed");
    assert_eq!(error(&confirm(&admin, CURRENT_SHA256).await), (StatusCode::CONFLICT, json!(NOT_HELD)));
    assert_eq!(error(&discard(&admin, CURRENT_SHA256).await), (StatusCode::CONFLICT, json!(NOT_HELD)));
    assert_eq!(devices(&core).await, 0);
    held(&admin, &core).await;
    assert_eq!(
        confirm(&admin, CURRENT_SHA256).await.status,
        StatusCode::OK,
        "the same archive uploads again"
    );
    drop(admin);
    core.stop().await;
}

#[tokio::test]
async fn a_discard_while_an_import_runs_is_a_409_that_leaves_the_import() {
    let (core, admin) = importer("import-discard-running", UploadLimit::default()).await;
    held(&admin, &core).await;
    let (reached, resume) = pause(&core.seams.import_pause);
    let meanwhile = async {
        reached.await.expect("the import runs");
        let refused = discard(&admin, CURRENT_SHA256).await;
        resume.send(()).expect("the import waits");
        refused
    };
    let (confirmed, refused) = tokio::join!(confirm(&admin, CURRENT_SHA256), meanwhile);
    assert_eq!(error(&refused), (StatusCode::CONFLICT, json!(RUNNING)));
    assert_eq!(confirmed.status, StatusCode::OK);
    assert_eq!(devices(&core).await, 1);
    drop(admin);
    core.stop().await;
}

#[tokio::test]
async fn discarding_is_for_admins_only() {
    let (core, admin) = importer("import-discard-auth", UploadLimit::default()).await;
    held(&admin, &core).await;
    let user = reads::plain_user(&admin).await;
    for (who, status) in [(&user, StatusCode::FORBIDDEN), (&admin.anonymous(), StatusCode::UNAUTHORIZED)] {
        assert_eq!(discard(who, CURRENT_SHA256).await.status, status);
        assert!(core.upload.exists(), "refused: the held upload stays");
    }
    assert_eq!(confirm(&admin, CURRENT_SHA256).await.status, StatusCode::OK, "still held for the admin");
    drop(admin);
    core.stop().await;
}

#[tokio::test]
async fn another_admin_can_neither_confirm_nor_discard_the_held_upload() {
    let (core, first) = importer("import-per-admin", UploadLimit::default()).await;
    let (_, second) = signed_in_user(&first, "second@example.org", true).await;
    held(&first, &core).await;
    for refused in [confirm(&second, CURRENT_SHA256).await, discard(&second, CURRENT_SHA256).await] {
        assert_eq!(
            error(&refused),
            (StatusCode::FORBIDDEN, json!("The held upload belongs to another admin"))
        );
        assert!(core.upload.exists(), "the held upload stays");
    }
    assert_eq!(devices(&core).await, 0);
    assert_eq!(confirm(&first, CURRENT_SHA256).await.status, StatusCode::OK, "its uploader still confirms");
    drop((first, second));
    core.stop().await;
}

const ANOTHER_ADMINS: &str = "Another admin's upload is held: they confirm or discard it first";

/// The held upload's file still as uploaded and its owner's wait still raised.
fn assert_held(core: &Core) {
    assert_eq!(std::fs::read(&core.upload).expect("held"), archive("current-2.x"));
    assert!(core.imports.try_lock().expect("free").is_some(), "the wait is raised");
}

#[tokio::test]
async fn another_admins_upload_is_a_403_that_leaves_the_held_upload() {
    let (core, first) = importer("import-held-refused", UploadLimit::default()).await;
    let (_, second) = signed_in_user(&first, "second@example.org", true).await;
    held(&first, &core).await;
    for bytes in [b"not an archive".to_vec(), archive("current-2.x"), archive("legacy-1.2.0")] {
        assert_eq!(error(&upload(&second, bytes).await), (StatusCode::FORBIDDEN, json!(ANOTHER_ADMINS)));
        assert_held(&core);
    }
    assert_eq!(
        error(&send_upload(&second, None, stalled()).await),
        (StatusCode::FORBIDDEN, json!(ANOTHER_ADMINS)),
        "refused before the body is read"
    );
    assert_eq!(error(&confirm(&second, CURRENT_SHA256).await).0, StatusCode::FORBIDDEN);
    assert_eq!(confirm(&first, CURRENT_SHA256).await.status, StatusCode::OK, "its uploader still confirms");
    drop((first, second));
    core.stop().await;
}

#[tokio::test]
async fn an_admin_replaces_their_own_held_upload_and_another_uploads_once_it_is_gone() {
    let (core, first) = importer("import-held-replaced", UploadLimit::default()).await;
    let (_, second) = signed_in_user(&first, "second@example.org", true).await;
    held(&first, &core).await;
    assert_eq!(upload(&first, archive("current-2.x")).await.status, StatusCode::ACCEPTED);
    assert_held(&core);
    assert_eq!(discard(&first, CURRENT_SHA256).await.status, StatusCode::NO_CONTENT);
    assert_eq!(
        upload(&second, archive("current-2.x")).await.status,
        StatusCode::ACCEPTED,
        "the slot is free"
    );
    assert_eq!(error(&confirm(&first, CURRENT_SHA256).await).0, StatusCode::FORBIDDEN, "now the second's");
    assert_eq!(confirm(&second, CURRENT_SHA256).await.status, StatusCode::OK);
    drop((first, second));
    core.stop().await;
}

/// A device in the store, as a poll or another import would leave it.
async fn fill(core: &Core) {
    let connection =
        NewConnection { transport: Transport::Tcp, host: "127.0.0.1".into(), port: 1, logger_serial: None };
    let connection = core.store.add_connection(&connection).await.expect("connection");
    let device = NewDevice { connection_id: connection, profile_id: "oracle".into(), unit_id: 1 };
    core.store.add_device(&device).await.expect("device");
}

#[tokio::test]
async fn an_upload_into_a_filled_store_is_a_409_that_leaves_the_held_upload() {
    let (core, admin) = importer("import-held-not-empty", UploadLimit::default()).await;
    held(&admin, &core).await;
    fill(&core).await;
    assert_eq!(
        error(&upload(&admin, archive("legacy-1.2.0")).await),
        (StatusCode::CONFLICT, json!(NOT_EMPTY))
    );
    assert_held(&core);
    drop(admin);
    core.stop().await;
}

#[tokio::test]
async fn a_store_filled_after_the_upload_is_a_409_at_the_confirmation() {
    let (core, admin) = importer("import-filled-after", UploadLimit::default()).await;
    held(&admin, &core).await;
    fill(&core).await;
    assert_eq!(error(&confirm(&admin, CURRENT_SHA256).await), (StatusCode::CONFLICT, json!(NOT_EMPTY)));
    assert_eq!(devices(&core).await, 1, "nothing was added");
    drop(admin);
    core.stop().await;
}
