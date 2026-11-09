//! The SPA embedded in the binary (ADR 11), served from memory without a session.

use axum::body::Body;
use axum::http::{Request, Response, StatusCode, header};
use tempfile::TempDir;

use super::{Core, get};

async fn core() -> (TempDir, Core) {
    let dir = tempfile::tempdir().unwrap();
    let core = Core::open(&dir.path().join("core.sqlite")).await;
    (dir, core)
}

async fn text(response: Response<Body>) -> String {
    let body = axum::body::to_bytes(response.into_body(), 1 << 24)
        .await
        .unwrap();
    String::from_utf8(body.to_vec()).unwrap()
}

fn accepting(encoding: &str, mut request: Request<Body>) -> Request<Body> {
    request
        .headers_mut()
        .insert(header::ACCEPT_ENCODING, encoding.parse().unwrap());
    request
}

/// The quoted values in the page that name a built asset.
fn assets(page: &str) -> Vec<&str> {
    page.split(['"', '\''])
        .filter(|value| value.contains("_app/"))
        .collect()
}

#[tokio::test]
async fn the_core_serves_the_screen_at_its_root_without_a_session() {
    let (_dir, core) = core().await;

    let response = core.send(get("/")).await;

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response.headers()[header::CONTENT_TYPE],
        "text/html; charset=utf-8"
    );
    assert!(text(response).await.starts_with("<!doctype html>"));
}

#[tokio::test]
async fn every_asset_the_screen_links_is_relative_so_it_works_under_a_prefix() {
    let (_dir, core) = core().await;
    let page = text(core.send(get("/")).await).await;
    let linked = assets(&page);
    assert!(!linked.is_empty(), "the screen links no assets");

    for asset in linked {
        let path = asset
            .strip_prefix("./")
            .unwrap_or_else(|| panic!("`{asset}` is not relative to the page"));
        let response = core.send(get(&format!("/{path}"))).await;

        assert_eq!(response.status(), StatusCode::OK, "{asset}");
        assert_eq!(
            response.headers()[header::CONTENT_TYPE],
            "text/javascript; charset=utf-8",
            "{asset}"
        );
    }
}

#[tokio::test]
async fn a_browser_gets_the_smallest_precompressed_encoding_it_accepts() {
    let (_dir, core) = core().await;
    let size = async |encoding: &str| {
        let response = core.send(accepting(encoding, get("/"))).await;
        let headers = response.headers().clone();
        assert_eq!(headers[header::VARY], "accept-encoding");
        let encoding = headers
            .get(header::CONTENT_ENCODING)
            .map(|e| e.to_str().unwrap().to_owned());
        let body = axum::body::to_bytes(response.into_body(), 1 << 24)
            .await
            .unwrap();
        (encoding, body.len())
    };

    let (identity, plain) = size("identity").await;
    let (gzip, gzipped) = size("gzip").await;
    let (brotli, compressed) = size("gzip, deflate, br").await;
    let (refused, _) = size("br;q=0, gzip").await;

    assert_eq!(identity, None);
    assert_eq!(gzip.as_deref(), Some("gzip"));
    assert_eq!(brotli.as_deref(), Some("br"));
    assert_eq!(refused.as_deref(), Some("gzip"));
    assert!(compressed < gzipped && gzipped < plain);
}

#[tokio::test]
async fn hashed_assets_are_cached_for_good_and_the_page_is_revalidated() {
    let (_dir, core) = core().await;
    let page = text(core.send(get("/")).await).await;
    let asset = assets(&page)[0].trim_start_matches('.');

    let page = core.send(get("/")).await;
    let asset = core.send(get(asset)).await;

    assert_eq!(page.headers()[header::CACHE_CONTROL], "no-cache");
    assert_eq!(
        asset.headers()[header::CACHE_CONTROL],
        "public, max-age=31536000, immutable"
    );
}

#[tokio::test]
async fn a_path_that_is_no_asset_is_still_a_problem() {
    let (_dir, core) = core().await;

    let response = core.send(get("/_app/missing.js")).await;

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    assert_eq!(
        response.headers()[header::CONTENT_TYPE],
        "application/problem+json"
    );
}
