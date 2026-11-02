//! Cross-site request refusal and the client address behind a proxy.
//!
//! A state-changing request must come from a trusted origin: the host it was sent to (page script can
//! set neither `Origin` nor `Host`, so a cross-site page cannot make them agree) or one configured with
//! `--trusted-origin`. A request without `Origin` is refused only when it carries a cookie: browsers send
//! `Origin` on every non-GET request, and without a cookie there is no session to ride.

use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;

use axum::extract::{Request, State};
use axum::http::{HeaderMap, Method, header};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};

use super::ApiError;

/// `host[:port]` of an `http(s)://host[:port]` origin; `None` for anything else, including `null`.
pub fn origin_authority(origin: &str) -> Option<&str> {
    let authority = origin.strip_prefix("https://").or_else(|| origin.strip_prefix("http://"))?;
    let usable = !authority.is_empty() && !authority.contains(['/', '@', '?', '#']);
    usable.then_some(authority)
}

pub fn allowed(method: &Method, headers: &HeaderMap, trusted: &[String]) -> bool {
    if method.is_safe() {
        return true;
    }
    let Some(origin) = headers.get(header::ORIGIN) else { return !headers.contains_key(header::COOKIE) };
    let Ok(origin) = origin.to_str() else { return false };
    let Some(authority) = origin_authority(origin) else { return false };
    let host = headers.get(header::HOST).and_then(|host| host.to_str().ok());
    host.is_some_and(|host| host.eq_ignore_ascii_case(authority)) || trusted.iter().any(|t| t == origin)
}

pub async fn refuse_untrusted(
    State(trusted): State<Arc<[String]>>,
    request: Request,
    next: Next,
) -> Response {
    if allowed(request.method(), request.headers(), &trusted) {
        next.run(request).await
    } else {
        ApiError::forbidden("Untrusted origin").into_response()
    }
}

/// The first `x-forwarded-for` address (set by the add-on's proxy), else the socket peer.
pub fn client_ip(headers: &HeaderMap, peer: Option<SocketAddr>) -> Option<IpAddr> {
    let forwarded = headers.get("x-forwarded-for").and_then(|value| value.to_str().ok());
    let first = forwarded.and_then(|list| list.split(',').next()).and_then(|ip| ip.trim().parse().ok());
    first.or(peer.map(|peer| peer.ip()))
}

#[cfg(test)]
mod tests {
    use axum::http::HeaderValue;

    use super::*;

    fn headers(pairs: &[(&'static str, &'static str)]) -> HeaderMap {
        let mut map = HeaderMap::new();
        for (name, value) in pairs {
            map.append(*name, HeaderValue::from_static(value));
        }
        map
    }

    #[test]
    fn an_origin_names_its_host_and_port_and_anything_else_names_none() {
        assert_eq!(origin_authority("https://ha.example"), Some("ha.example"));
        assert_eq!(origin_authority("http://192.168.1.5:8099"), Some("192.168.1.5:8099"));
        for refused in
            ["null", "", "https://", "ftp://ha.example", "https://ha.example/path", "https://u@ha.example"]
        {
            assert_eq!(origin_authority(refused), None, "{refused}");
        }
    }

    #[test]
    fn a_write_from_the_host_it_was_sent_to_or_a_trusted_origin_is_allowed() {
        let trusted = ["https://ha.example".to_owned()];
        let same = headers(&[
            ("host", "sunreye.lan:8099"),
            ("origin", "http://sunreye.lan:8099"),
            ("cookie", "id=x"),
        ]);
        assert!(allowed(&Method::POST, &same, &trusted));
        let configured =
            headers(&[("host", "10.0.0.2"), ("origin", "https://ha.example"), ("cookie", "id=x")]);
        assert!(allowed(&Method::DELETE, &configured, &trusted));
    }

    #[test]
    fn a_write_from_another_origin_or_with_a_cookie_and_no_origin_is_refused() {
        let trusted = ["https://ha.example".to_owned()];
        for pairs in [
            [("host", "sunreye.lan"), ("origin", "https://evil.example"), ("cookie", "id=x")],
            [("host", "sunreye.lan"), ("origin", "http://sunreye.lan:8100"), ("cookie", "id=x")],
            [("host", "sunreye.lan"), ("origin", "https://ha.example.evil"), ("cookie", "id=x")],
            [("host", "sunreye.lan"), ("origin", "null"), ("cookie", "id=x")],
            [("host", "sunreye.lan"), ("cookie", "id=x"), ("accept", "*/*")],
        ] {
            assert!(!allowed(&Method::PUT, &headers(&pairs), &trusted), "{pairs:?}");
        }
        let no_cookie = headers(&[("host", "sunreye.lan"), ("origin", "https://evil.example")]);
        assert!(
            !allowed(&Method::POST, &no_cookie, &trusted),
            "an Origin is checked with or without a cookie"
        );
    }

    #[test]
    fn a_read_or_a_cookieless_request_without_origin_is_allowed() {
        let cross =
            headers(&[("host", "sunreye.lan"), ("origin", "https://evil.example"), ("cookie", "id=x")]);
        for method in [Method::GET, Method::HEAD, Method::OPTIONS] {
            assert!(allowed(&method, &cross, &[]), "{method}");
        }
        assert!(allowed(&Method::POST, &headers(&[("host", "sunreye.lan")]), &[]));
    }

    #[test]
    fn the_client_is_the_first_forwarded_address_else_the_peer() {
        let peer = Some(SocketAddr::from(([10, 0, 0, 1], 5000)));
        let forwarded = headers(&[("x-forwarded-for", "203.0.113.7, 10.0.0.1")]);
        assert_eq!(client_ip(&forwarded, peer), Some(IpAddr::from([203, 0, 113, 7])));
        assert_eq!(client_ip(&HeaderMap::new(), peer), Some(IpAddr::from([10, 0, 0, 1])));
        let garbage = headers(&[("x-forwarded-for", "not-an-ip")]);
        assert_eq!(client_ip(&garbage, peer), Some(IpAddr::from([10, 0, 0, 1])));
        assert_eq!(client_ip(&HeaderMap::new(), None), None);
    }
}
