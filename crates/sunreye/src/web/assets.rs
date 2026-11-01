//! The SPA, embedded in the binary and served from the same origin as the API.
//!
//! `build.rs` embeds `apps/web/build` when it holds a static build (`bun run --cwd apps/web build:static`,
//! or `SUNREYE_SPA_DIR`), else a placeholder page.

use axum::http::{HeaderValue, StatusCode, Uri, header};
use axum::response::{IntoResponse, Response};
use rust_embed::RustEmbed;

#[derive(RustEmbed)]
#[folder = "$SUNREYE_EMBED_DIR"]
struct Spa;

const INDEX: &str = "index.html";
/// Content-hashed files never change under their name.
const IMMUTABLE: &str = "public, max-age=31536000, immutable";

/// A file of the embedded build.
pub struct Asset {
    pub path: String,
    pub mime: String,
    pub body: Vec<u8>,
}

/// Serves the file at `uri`, or the app shell for a route the SPA renders itself. A missing file or an
/// unknown API path is a 404, never the shell: a script that 404s must not arrive as HTML.
pub async fn serve(uri: Uri) -> Response {
    match resolve(uri.path(), lookup) {
        Some(asset) => respond(asset),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

fn lookup(path: &str) -> Option<Asset> {
    let file = Spa::get(path)?;
    Some(Asset {
        path: path.to_owned(),
        mime: file.metadata.mimetype().to_owned(),
        body: file.data.into_owned(),
    })
}

fn resolve(request_path: &str, files: impl Fn(&str) -> Option<Asset>) -> Option<Asset> {
    let path = request_path.trim_start_matches('/');
    if is_reserved(path) {
        return None;
    }
    let wanted = if path.is_empty() { INDEX } else { path };
    match files(wanted) {
        Some(asset) => Some(asset),
        None if has_extension(wanted) => None,
        None => files(INDEX),
    }
}

/// Paths the API and the feed own; none of them is an SPA route.
fn is_reserved(path: &str) -> bool {
    ["api", "openapi", "ws"]
        .iter()
        .any(|prefix| path.strip_prefix(prefix).is_some_and(|rest| rest.is_empty() || rest.starts_with('/')))
}

fn has_extension(path: &str) -> bool {
    path.rsplit('/').next().is_some_and(|name| name.contains('.'))
}

fn respond(asset: Asset) -> Response {
    let cache = if asset.path.starts_with("_app/immutable/") { IMMUTABLE } else { "no-cache" };
    let mut response = asset.body.into_response();
    let headers = response.headers_mut();
    if let Ok(mime) = HeaderValue::from_str(&asset.mime) {
        headers.insert(header::CONTENT_TYPE, mime);
    }
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static(cache));
    response
}

#[cfg(test)]
mod tests {
    use super::*;

    fn files(path: &str) -> Option<Asset> {
        let known = ["index.html", "favicon.png", "_app/immutable/entry/app.js"];
        known.contains(&path).then(|| Asset { path: path.to_owned(), mime: "x/y".into(), body: path.into() })
    }

    fn served(path: &str) -> Option<String> {
        resolve(path, files).map(|asset| asset.path)
    }

    #[test]
    fn the_root_and_an_exact_file_are_served_as_they_are() {
        assert_eq!(served("/").as_deref(), Some("index.html"));
        assert_eq!(served("/favicon.png").as_deref(), Some("favicon.png"));
        assert_eq!(served("/_app/immutable/entry/app.js").as_deref(), Some("_app/immutable/entry/app.js"));
    }

    #[test]
    fn a_route_the_spa_renders_gets_the_shell() {
        assert_eq!(served("/settings/devices").as_deref(), Some("index.html"));
        assert_eq!(served("/setup").as_deref(), Some("index.html"));
    }

    #[test]
    fn a_missing_file_is_not_the_shell() {
        assert_eq!(served("/_app/immutable/entry/gone.js"), None);
        assert_eq!(served("/robots.txt"), None);
    }

    #[test]
    fn api_paths_are_never_the_shell() {
        for path in ["/api", "/api/nothing", "/openapi", "/openapi/json", "/ws", "/ws/x"] {
            assert_eq!(served(path), None, "{path}");
        }
        assert_eq!(served("/apiary").as_deref(), Some("index.html"), "only whole segments are reserved");
    }

    #[test]
    fn a_build_without_a_shell_serves_nothing_for_routes() {
        assert!(resolve("/setup", |_| None).is_none());
    }

    #[test]
    fn only_hashed_files_are_cached_for_good() {
        let hashed =
            Asset { path: "_app/immutable/a.js".into(), mime: "text/javascript".into(), body: vec![] };
        let shell = Asset { path: "index.html".into(), mime: "text/html".into(), body: vec![] };
        assert_eq!(respond(hashed).headers()[header::CACHE_CONTROL], IMMUTABLE);
        assert_eq!(respond(shell).headers()[header::CACHE_CONTROL], "no-cache");
    }

    #[test]
    fn the_embedded_build_has_a_shell_that_is_html() {
        let shell = lookup(INDEX).expect("the embedded build has an index.html");
        assert!(shell.mime.starts_with("text/html"), "{}", shell.mime);
        let text = String::from_utf8(shell.body).expect("utf8");
        assert!(text.to_lowercase().contains("<html"));
    }
}
