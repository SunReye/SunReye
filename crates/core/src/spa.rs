//! The SPA (ADR 11): its precompressed build, embedded at compile time and served from memory.

use axum::http::{HeaderMap, HeaderValue, Method, Uri, header};
use axum::response::{IntoResponse, Response};

/// One built file and the precompressed copies the build wrote beside it.
struct Asset {
    path: &'static str,
    identity: &'static [u8],
    gzip: Option<&'static [u8]>,
    brotli: Option<&'static [u8]>,
}

/// Sorted by path.
static ASSETS: &[Asset] = include!(concat!(env!("OUT_DIR"), "/spa.rs"));

/// Kit's hashed output: a changed file gets a new name.
const IMMUTABLE: &str = "_app/immutable/";

/// The built file at `uri`, or `None`; the root is `index.html`. The hash router keeps every
/// screen at the root, so there is no fallback page.
pub fn serve(method: &Method, uri: &Uri, headers: &HeaderMap) -> Option<Response> {
    if method != Method::GET && method != Method::HEAD {
        return None;
    }
    let path = match uri.path().trim_start_matches('/') {
        "" => "index.html",
        path => path,
    };
    let asset = ASSETS
        .binary_search_by(|a| a.path.cmp(path))
        .ok()
        .and_then(|i| ASSETS.get(i))?;
    let accepted = headers
        .get_all(header::ACCEPT_ENCODING)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .collect::<Vec<_>>()
        .join(",");
    let (encoding, body) = match (asset.brotli, asset.gzip) {
        (Some(body), _) if accepts(&accepted, "br") => (Some("br"), body),
        (_, Some(body)) if accepts(&accepted, "gzip") => (Some("gzip"), body),
        _ => (None, asset.identity),
    };
    let cache = if path.starts_with(IMMUTABLE) {
        "public, max-age=31536000, immutable"
    } else {
        "no-cache"
    };
    let mut response = (
        [
            (header::CONTENT_TYPE, content_type(path)),
            (header::CACHE_CONTROL, cache),
            (header::VARY, "accept-encoding"),
        ],
        body,
    )
        .into_response();
    if let Some(encoding) = encoding {
        response
            .headers_mut()
            .insert(header::CONTENT_ENCODING, HeaderValue::from_static(encoding));
    }
    Some(response)
}

/// Whether an `Accept-Encoding` list names `coding` with a weight above zero.
fn accepts(list: &str, coding: &str) -> bool {
    list.split(',').any(|item| {
        let mut parts = item.split(';').map(str::trim);
        parts
            .next()
            .is_some_and(|name| name.eq_ignore_ascii_case(coding))
            && !parts.any(|p| {
                p.strip_prefix("q=")
                    .and_then(|q| q.parse::<f32>().ok())
                    .is_some_and(|q| q <= 0.0)
            })
    })
}

fn content_type(path: &str) -> &'static str {
    match path.rsplit_once('.').map_or("", |(_, extension)| extension) {
        "html" => "text/html; charset=utf-8",
        "js" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" => "application/json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "ico" => "image/x-icon",
        "woff2" => "font/woff2",
        "txt" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}
