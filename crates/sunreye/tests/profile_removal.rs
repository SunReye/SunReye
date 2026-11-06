//! An admin removes an imported profile and a stored profile source over HTTP. The profile files are the
//! compiled-in set's own JSON under other ids, stored through the library as an earlier session would have.

#![allow(clippy::expect_used, reason = "helpers outside #[test] fns may panic like the tests")]

use std::path::{Path, PathBuf};
use std::sync::Arc;

use axum::Router;
use axum::body::{Body, to_bytes};
use axum::http::{Method, Request, StatusCode, header};
use serde_json::{Value, json};
use sunreye::run::Core;
use sunreye::settings::set_active_profile;
use sunreye::sources::{Installed, Source, import_profile, save_source};
use sunreye::web::{Config, router};
use tower::ServiceExt;

mod support;
use support::official_files;

const BASE: &str = "https://profiles.example.org/repo/";

fn dir(name: &str) -> PathBuf {
    let dir = Path::new(env!("CARGO_TARGET_TMPDIR")).join(format!("removal-{name}-{}", std::process::id()));
    drop(std::fs::remove_dir_all(&dir));
    dir
}

/// An official profile under another id, validated as a stored one.
fn profile(id: &str) -> Installed {
    let mut file = official_files().remove(0).1;
    file["id"] = json!(id);
    file["name"] = json!(format!("Profile {id}"));
    Installed::validate(file.to_string()).expect("valid profile")
}

fn source(index_path: &str) -> Source {
    Source { base_url: BASE.into(), index_path: index_path.into() }
}

struct Api {
    router: Router,
    cookie: String,
}

struct Answer {
    status: StatusCode,
    /// `name=value` of the cookie the answer set.
    cookie: Option<String>,
    body: Vec<u8>,
}

impl Answer {
    fn json(&self) -> Value {
        serde_json::from_slice(&self.body).expect("a json body")
    }
}

async fn call(router: &Router, cookie: &str, method: Method, path: &str, body: Option<Value>) -> Answer {
    let request = Request::builder()
        .method(method)
        .uri(path)
        .header(header::HOST, "sunreye.lan")
        .header(header::ORIGIN, "http://sunreye.lan")
        .header(header::CONTENT_TYPE, "application/json")
        .header(header::COOKIE, cookie)
        .body(body.map_or_else(Body::empty, |value| Body::from(value.to_string())))
        .expect("request");
    let response = router.clone().oneshot(request).await.expect("response");
    let status = response.status();
    let cookie = response.headers().get(header::SET_COOKIE).and_then(|value| value.to_str().ok());
    let cookie = cookie.and_then(|value| value.split(';').next()).map(str::to_owned);
    Answer { status, cookie, body: to_bytes(response.into_body(), usize::MAX).await.expect("body").to_vec() }
}

impl Api {
    async fn send(&self, method: Method, path: &str) -> Answer {
        call(&self.router, &self.cookie, method, path, None).await
    }

    async fn get(&self, path: &str) -> Value {
        self.send(Method::GET, path).await.json()
    }

    async fn profile_ids(&self) -> Vec<String> {
        let listed = self.get("/api/profiles").await;
        let installed = listed.as_array().expect("array").iter().filter(|p| p["installed"] == true);
        installed.map(|p| p["id"].as_str().expect("id").to_owned()).collect()
    }

    async fn remove_source(&self, source: &Source) -> Answer {
        let path = format!(
            "/api/settings/profile-sources?baseUrl={}&indexPath={}",
            source.base_url, source.index_path
        );
        self.send(Method::DELETE, &path).await
    }
}

/// The core on `dir` with the admin signed in, created on a fresh store and logged in on a reopened one.
async fn open(dir: &Path) -> (Arc<Core>, Api) {
    let core = Core::open(dir).await.expect("core");
    let router = router(Arc::clone(&core), &Config::default());
    let credentials =
        json!({"email": "admin@example.org", "name": "Admin", "password": "correct horse battery"});
    let mut answer = call(&router, "", Method::POST, "/api/auth/sign-up", Some(credentials.clone())).await;
    if answer.status == StatusCode::FORBIDDEN {
        answer = call(&router, "", Method::POST, "/api/auth/login", Some(credentials)).await;
    }
    assert_eq!(answer.status, StatusCode::OK, "admin session");
    let cookie = answer.cookie.expect("a session cookie");
    (core, Api { router, cookie })
}

async fn close(core: Arc<Core>, api: Api) {
    drop(api);
    core.stop().await;
}

#[tokio::test]
async fn an_imported_profile_is_removed_and_stays_removed_after_a_restart() {
    let dir = dir("import");
    let (core, api) = open(&dir).await;
    import_profile(&core.store, &profile("acme-one")).await.expect("import");
    import_profile(&core.store, &profile("acme-two")).await.expect("import");
    assert_eq!(api.profile_ids().await, ["acme-one", "acme-two"]);

    let removed = api.send(Method::DELETE, "/api/settings/profiles/acme-one").await;
    assert_eq!(removed.status, StatusCode::NO_CONTENT);
    assert_eq!(api.profile_ids().await, ["acme-two"], "only the removed profile goes");
    close(core, api).await;

    let (core, api) = open(&dir).await;
    assert_eq!(api.profile_ids().await, ["acme-two"]);
    close(core, api).await;
    drop(std::fs::remove_dir_all(&dir));
}

#[tokio::test]
async fn a_profile_a_source_supplied_is_removed_from_the_source_too() {
    let dir = dir("sourced");
    let (core, api) = open(&dir).await;
    let held = source("index.json");
    save_source(&core.store, &held, &[profile("acme-one"), profile("acme-two")]).await.expect("save");

    let removed = api.send(Method::DELETE, "/api/settings/profiles/acme-one").await;
    assert_eq!(removed.status, StatusCode::NO_CONTENT);
    assert_eq!(
        api.get("/api/settings/profile-sources").await,
        json!([{"baseUrl": BASE, "indexPath": "index.json", "profileIds": ["acme-two"]}])
    );
    close(core, api).await;
    drop(std::fs::remove_dir_all(&dir));
}

#[tokio::test]
async fn removing_a_profile_that_is_unknown_compiled_in_or_active_is_refused_and_removes_nothing() {
    let dir = dir("refused");
    let (core, api) = open(&dir).await;
    import_profile(&core.store, &profile("acme-active")).await.expect("import");
    set_active_profile(&core.store, "acme-active").await.expect("choose");

    let unknown = api.send(Method::DELETE, "/api/settings/profiles/nothing").await;
    assert_eq!(unknown.status, StatusCode::NOT_FOUND);
    let compiled_in = core.bundle.profiles[0].profile.id.clone();
    let builtin = api.send(Method::DELETE, &format!("/api/settings/profiles/{compiled_in}")).await;
    assert_eq!(builtin.status, StatusCode::BAD_REQUEST);
    let active = api.send(Method::DELETE, "/api/settings/profiles/acme-active").await;
    assert_eq!(active.status, StatusCode::CONFLICT);
    assert_eq!(active.json(), json!({"error": "the active profile cannot be removed"}));

    assert_eq!(api.profile_ids().await, ["acme-active"]);
    close(core, api).await;
    drop(std::fs::remove_dir_all(&dir));
}

#[tokio::test]
async fn a_removed_source_takes_its_profiles_but_not_those_another_holder_supplies() {
    let dir = dir("source");
    let (core, api) = open(&dir).await;
    let (gone, kept) = (source("gone.json"), source("kept.json"));
    save_source(&core.store, &gone, &[profile("only-gone"), profile("shared")]).await.expect("save");
    save_source(&core.store, &kept, &[profile("only-kept"), profile("shared")]).await.expect("save");
    assert_eq!(api.profile_ids().await, ["only-gone", "shared", "only-kept"]);

    let removed = api.remove_source(&gone).await;
    assert_eq!(removed.status, StatusCode::NO_CONTENT);
    assert_eq!(
        api.get("/api/settings/profile-sources").await,
        json!([{"baseUrl": BASE, "indexPath": "kept.json", "profileIds": ["only-kept", "shared"]}])
    );
    assert_eq!(api.profile_ids().await, ["only-kept", "shared"]);
    close(core, api).await;

    let (core, api) = open(&dir).await;
    assert_eq!(api.get("/api/settings/profile-sources").await.as_array().map(Vec::len), Some(1));
    close(core, api).await;
    drop(std::fs::remove_dir_all(&dir));
}

#[tokio::test]
async fn removing_a_source_that_is_unknown_malformed_or_supplies_the_active_profile_is_refused() {
    let dir = dir("source-refused");
    let (core, api) = open(&dir).await;
    let held = source("index.json");
    save_source(&core.store, &held, &[profile("acme-active")]).await.expect("save");
    set_active_profile(&core.store, "acme-active").await.expect("choose");

    let unknown = api.remove_source(&source("other.json")).await;
    assert_eq!(unknown.status, StatusCode::NOT_FOUND);
    let insecure =
        api.remove_source(&Source { base_url: "http://example.org/".into(), ..held.clone() }).await;
    assert_eq!(insecure.status, StatusCode::BAD_REQUEST);
    let missing = api.send(Method::DELETE, "/api/settings/profile-sources").await;
    assert_eq!(missing.status, StatusCode::BAD_REQUEST);
    let active = api.remove_source(&held).await;
    assert_eq!(active.status, StatusCode::CONFLICT);
    assert_eq!(active.json(), json!({"error": "the source supplies the active profile"}));

    assert_eq!(api.get("/api/settings/profile-sources").await.as_array().map(Vec::len), Some(1));
    assert_eq!(api.profile_ids().await, ["acme-active"]);
    close(core, api).await;
    drop(std::fs::remove_dir_all(&dir));
}

#[tokio::test]
async fn the_profile_list_carries_the_version_of_a_compiled_in_and_of_an_imported_profile() {
    let dir = dir("version");
    let (core, api) = open(&dir).await;
    let mut file = official_files().remove(0).1;
    file["id"] = json!("acme-one");
    file["version"] = json!("2.4.1");
    import_profile(&core.store, &Installed::validate(file.to_string()).expect("valid profile"))
        .await
        .expect("import");

    let listed = api.get("/api/profiles").await;
    let listed = listed.as_array().expect("array");
    let imported = listed.iter().find(|p| p["id"] == "acme-one").expect("listed");
    assert_eq!(imported["version"], "2.4.1");
    let compiled_in = &core.bundle.profiles[0].profile;
    let builtin = listed.iter().find(|p| p["id"] == json!(compiled_in.id)).expect("listed");
    assert_eq!(builtin["version"], json!(official_files().remove(0).1["version"]));
    close(core, api).await;
    drop(std::fs::remove_dir_all(&dir));
}
