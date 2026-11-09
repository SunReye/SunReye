//! The import from the SPA (ADR 18): an archive under `/share` or uploaded, run inside the core
//! while it keeps polling.

use std::path::Path;
use std::time::Duration;

use axum::body::{Body, Bytes};
use axum::http::{Request, StatusCode, header};
use futures_util::stream;
use serde_json::{Value, json};

use super::devices::{gateway, send};
use super::{Core, HOME, from, get, problem, with_cookie};
use crate::transport::fake;

const SLUG: &str = "deye-sun15k-sg05lp3";

/// v3's export of a one-Deye plant, see `import/tests.rs`.
fn fixture() -> Vec<u8> {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/fixtures/import/v3-plant.tar.gz"
    );
    std::fs::read(path).unwrap()
}

/// The core's `/share`, beside its store in the tests.
fn share(dir: &Path) -> std::path::PathBuf {
    dir.join("share")
}

/// Puts the fixture at `relative` under the share.
fn shared(dir: &Path, relative: &str) {
    let path = share(dir).join(relative);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, fixture()).unwrap();
}

fn start(path: Option<&str>, device: &Value) -> Request<Body> {
    let mut body = json!({ "devices": [{ "slug": SLUG, "device": device }] });
    if let Some(path) = path {
        body["path"] = json!(path);
    }
    send("POST", "/api/v1/import", &body)
}

impl Core {
    /// The status and problem code of a refused request.
    pub(super) async fn refusal(
        &self,
        set_cookie: &str,
        request: Request<Body>,
    ) -> (StatusCode, String) {
        problem(self.send(with_cookie(set_cookie, request)).await).await
    }

    /// The import's status once it no longer runs.
    async fn finished(&self, set_cookie: &str) -> Value {
        let mut status = Value::Null;
        let deadline = tokio::time::Instant::now() + Duration::from_secs(20);
        while tokio::time::Instant::now() < deadline {
            status = self.ask(set_cookie, get("/api/v1/import")).await.1;
            if status["state"] != "running" {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        status
    }
}

#[tokio::test]
async fn an_archive_under_share_is_imported_into_the_mapped_device_and_its_result_reported() {
    let dir = tempfile::tempdir().unwrap();
    let (core, admin) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    shared(dir.path(), "v3/export.tar.gz");
    let connection = core.connection(&admin, &gateway()).await;
    let device = core.deye(&admin, &connection, 1).await;

    let (status, started) = core
        .ask(&admin, start(Some("v3/export.tar.gz"), &device))
        .await;
    let finished = core.finished(&admin).await;

    assert_eq!(status, StatusCode::ACCEPTED, "{started}");
    assert_eq!(started["state"], "running");
    assert_eq!(finished["state"], "done", "{finished}");
    let report = &finished["report"];
    assert_eq!(finished["done"], report["series"]);
    assert_eq!(finished["total"], report["series"]);
    assert!(report["series"].as_u64().unwrap() > 0);
    assert!(report["points"].as_u64().unwrap() > 0);
    assert_eq!(
        report["unread"],
        json!([format!("{SLUG}/battery.daily_charge")])
    );
    assert_eq!(report["unmapped"], json!([]));
}

#[tokio::test]
async fn the_core_keeps_polling_while_an_import_runs_and_refuses_a_second() {
    let dir = tempfile::tempdir().unwrap();
    let (core, admin) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    shared(dir.path(), "export.tar.gz");
    let inverter = fake::serve().await;
    let port = inverter.address.port();
    let gateway = json!({ "name": "gateway", "transport": "modbus-tcp", "host": "127.0.0.1",
        "port": port });
    let connection = core.connection(&admin, &gateway).await;
    let device = core.deye(&admin, &connection, 1).await;
    let mut readings = core.bus.subscribe();
    // Holds the storage thread, so the import cannot finish before the test lets it.
    let (release, waiting) = std::sync::mpsc::channel::<()>();
    let database = core.storage.database();
    let hold = tokio::spawn(async move {
        database
            .run(move |_| {
                waiting.recv().ok();
                Ok(())
            })
            .await
    });

    let started = core.ask(&admin, start(Some("export.tar.gz"), &device));
    let (status, _) = tokio::time::timeout(Duration::from_secs(5), started)
        .await
        .expect("the import holds up its request");
    let polled = tokio::time::timeout(Duration::from_secs(20), readings.recv()).await;
    let (_, running) = core.ask(&admin, get("/api/v1/import")).await;
    let again = core
        .refusal(&admin, start(Some("export.tar.gz"), &device))
        .await;
    release.send(()).unwrap();
    hold.await.unwrap().unwrap();
    let finished = core.finished(&admin).await;

    assert_eq!(status, StatusCode::ACCEPTED);
    assert_eq!(polled.unwrap().unwrap().device.0, id(&device));
    assert_eq!(running["state"], "running");
    assert_eq!(again, (StatusCode::CONFLICT, "import.busy".to_owned()));
    assert_eq!(finished["state"], "done", "{finished}");
}

fn id(value: &Value) -> u32 {
    u32::try_from(value.as_u64().unwrap()).unwrap()
}

#[tokio::test]
async fn a_path_that_leaves_share_is_refused_and_nothing_imported() {
    let dir = tempfile::tempdir().unwrap();
    let (core, admin) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    shared(dir.path(), "v3/export.tar.gz");
    // An archive outside the share, reached by `..`, an absolute path or a symlink.
    std::fs::write(dir.path().join("outside.tar.gz"), fixture()).unwrap();
    let outside = dir.path().join("outside.tar.gz");
    std::os::unix::fs::symlink(&outside, share(dir.path()).join("link.tar.gz")).unwrap();
    std::os::unix::fs::symlink(dir.path(), share(dir.path()).join("up")).unwrap();
    let connection = core.connection(&admin, &gateway()).await;
    let device = core.deye(&admin, &connection, 1).await;

    let mut refusals = Vec::new();
    for path in [
        Some("../outside.tar.gz"),
        Some("v3/../../outside.tar.gz"),
        Some(outside.to_str().unwrap()),
        Some("link.tar.gz"),
        Some("up/outside.tar.gz"),
        Some("v3"),
        Some("v3/missing.tar.gz"),
        Some(""),
        // Nothing uploaded.
        None,
    ] {
        refusals.push(core.refusal(&admin, start(path, &device)).await);
    }
    let (_, status) = core.ask(&admin, get("/api/v1/import")).await;

    let path = (StatusCode::UNPROCESSABLE_ENTITY, "import.path".to_owned());
    assert_eq!(refusals, vec![path; 9]);
    assert_eq!(status["state"], "idle");
}

fn upload(body: Body) -> Request<Body> {
    let request = Request::post("/api/v1/import/upload")
        .header(header::CONTENT_TYPE, "application/gzip")
        .body(body)
        .unwrap();
    from(HOME, request)
}

/// The devices the fixture's archive holds.
fn devices() -> Value {
    json!([{ "slug": SLUG, "profile": SLUG }])
}

#[tokio::test]
async fn an_uploaded_archive_names_its_devices_and_is_imported() {
    let dir = tempfile::tempdir().unwrap();
    let (core, admin) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    let connection = core.connection(&admin, &gateway()).await;
    let device = core.deye(&admin, &connection, 1).await;

    let (status, archive) = core.ask(&admin, upload(Body::from(fixture()))).await;
    let (started, _) = core.ask(&admin, start(None, &device)).await;
    let finished = core.finished(&admin).await;

    assert_eq!(status, StatusCode::CREATED, "{archive}");
    assert_eq!(archive, json!({ "devices": devices() }));
    assert_eq!(started, StatusCode::ACCEPTED);
    assert_eq!(finished["state"], "done", "{finished}");
}

#[tokio::test]
async fn an_upload_past_the_cap_or_no_archive_is_refused_and_nothing_kept() {
    let dir = tempfile::tempdir().unwrap();
    let (core, admin) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    let connection = core.connection(&admin, &gateway()).await;
    let device = core.deye(&admin, &connection, 1).await;
    // Endless: the answer comes only if the core stops reading at the cap.
    let endless = stream::repeat_with(|| Ok::<_, std::io::Error>(Bytes::from(vec![0; 1 << 16])));

    let large = core
        .refusal(&admin, upload(Body::from_stream(endless)))
        .await;
    let broken = core
        .refusal(&admin, upload(Body::from(vec![0; 1024])))
        .await;
    let unprepared = core.refusal(&admin, start(None, &device)).await;

    assert_eq!(
        large,
        (StatusCode::PAYLOAD_TOO_LARGE, "import.size".to_owned())
    );
    assert_eq!(
        broken,
        (StatusCode::UNPROCESSABLE_ENTITY, "import.file".to_owned())
    );
    assert_eq!(
        unprepared,
        (StatusCode::UNPROCESSABLE_ENTITY, "import.path".to_owned())
    );
    let mut left: Vec<_> = std::fs::read_dir(dir.path())
        .unwrap()
        .map(|entry| entry.unwrap().file_name().into_string().unwrap())
        .filter(|name| name.starts_with("import"))
        .collect();
    left.sort();
    assert_eq!(left, Vec::<String>::new());
}

#[tokio::test]
async fn the_archives_under_share_are_listed_with_their_devices() {
    let dir = tempfile::tempdir().unwrap();
    let (core, admin) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    shared(dir.path(), "v3/export.tar.gz");
    shared(dir.path(), "first.tar.gz");
    std::fs::write(share(dir.path()).join("notes.txt"), "not an archive").unwrap();
    std::fs::write(share(dir.path()).join("broken.tar.gz"), "not an archive").unwrap();
    // Not followed: a symlink could lead out of the share.
    std::os::unix::fs::symlink(dir.path(), share(dir.path()).join("up")).unwrap();
    std::fs::write(dir.path().join("outside.tar.gz"), fixture()).unwrap();

    let (status, files) = core.ask(&admin, get("/api/v1/import/files")).await;

    assert_eq!(status, StatusCode::OK, "{files}");
    assert_eq!(
        files,
        json!({ "files": [
            { "path": "first.tar.gz", "devices": devices() },
            { "path": "v3/export.tar.gz", "devices": devices() },
        ] })
    );
}

#[tokio::test]
async fn without_a_share_no_archive_is_listed() {
    let dir = tempfile::tempdir().unwrap();
    let (core, admin) = Core::signed_in(&dir.path().join("core.sqlite")).await;

    let (status, files) = core.ask(&admin, get("/api/v1/import/files")).await;

    assert_eq!((status, files), (StatusCode::OK, json!({ "files": [] })));
}

#[tokio::test]
async fn an_import_that_fails_reports_why() {
    let dir = tempfile::tempdir().unwrap();
    let (core, admin) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    shared(dir.path(), "export.tar.gz");
    let elsewhere = json!({ "path": "export.tar.gz",
        "devices": [{ "slug": "elsewhere", "device": 7 }] });

    let (status, _) = core
        .ask(&admin, send("POST", "/api/v1/import", &elsewhere))
        .await;
    let finished = core.finished(&admin).await;

    assert_eq!(status, StatusCode::ACCEPTED);
    assert_eq!(
        finished,
        json!({ "state": "failed", "done": 0, "total": 0, "report": null,
            "problem": "import.device" })
    );
}
