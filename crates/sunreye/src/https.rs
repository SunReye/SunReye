//! The one HTTPS client: `reqwest` over `rustls` with the `ring` provider and the `webpki-roots` trust
//! store, the same on every target (ADR 0006).

use std::error::Error as _;
use std::sync::Arc;
use std::time::Duration;

use reqwest::redirect::Policy;
use reqwest::{Client, Response, StatusCode};
use rustls::crypto::ring::default_provider;
use rustls::pki_types::CertificateDer;
use rustls::{ClientConfig, RootCertStore};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Limits {
    /// Covers connecting, the response head and the whole body.
    pub timeout: Duration,
    /// Most body bytes accepted.
    pub max_bytes: usize,
}

#[derive(Debug, thiserror::Error)]
pub enum GetError {
    #[error("not an https url: {0}")]
    Url(String),
    #[error("cannot connect: {0}")]
    Connect(String),
    #[error("certificate refused: {0}")]
    Certificate(String),
    #[error("timed out")]
    Timeout,
    #[error("body exceeds {max_bytes} bytes")]
    TooLarge { max_bytes: usize },
    #[error("status {0}")]
    Status(u16),
    #[error("transfer failed: {0}")]
    Transfer(String),
}

/// GETs `url` and returns the body. A redirect is an error: the caller vetted this URL, not its target.
pub async fn get(url: &str, limits: Limits) -> Result<Vec<u8>, GetError> {
    get_with_roots(url, limits, &[]).await
}

/// [`get`] that also trusts `extra_roots`, for a private certificate authority.
pub async fn get_with_roots(
    url: &str,
    limits: Limits,
    extra_roots: &[CertificateDer<'_>],
) -> Result<Vec<u8>, GetError> {
    let client = client(limits.timeout, extra_roots)?;
    let response = client.get(url).send().await.map_err(|e| classify(&e))?;
    read_body(response, limits.max_bytes).await
}

fn client(timeout: Duration, extra_roots: &[CertificateDer<'_>]) -> Result<Client, GetError> {
    let mut roots = RootCertStore::empty();
    roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    for root in extra_roots {
        roots.add(root.clone()).map_err(|e| GetError::Certificate(e.to_string()))?;
    }
    let tls = ClientConfig::builder_with_provider(Arc::new(default_provider()))
        .with_safe_default_protocol_versions()
        .map_err(|e| GetError::Connect(e.to_string()))?
        .with_root_certificates(roots)
        .with_no_client_auth();
    Client::builder()
        .use_preconfigured_tls(tls)
        .https_only(true)
        .redirect(Policy::none())
        .timeout(timeout)
        .build()
        .map_err(|e| GetError::Connect(e.to_string()))
}

async fn read_body(mut response: Response, max_bytes: usize) -> Result<Vec<u8>, GetError> {
    let status = response.status();
    if status != StatusCode::OK {
        return Err(GetError::Status(status.as_u16()));
    }
    let too_large = GetError::TooLarge { max_bytes };
    if response.content_length().is_some_and(|n| n > max_bytes as u64) {
        return Err(too_large);
    }
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|e| classify(&e))? {
        if chunk.len() > max_bytes - body.len() {
            return Err(too_large);
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

fn classify(error: &reqwest::Error) -> GetError {
    if error.is_timeout() {
        return GetError::Timeout;
    }
    if error.is_builder() {
        return GetError::Url(error.to_string());
    }
    if is_certificate_error(error) {
        return GetError::Certificate(chain(error));
    }
    if error.is_connect() {
        return GetError::Connect(chain(error));
    }
    GetError::Transfer(chain(error))
}

fn is_certificate_error(error: &reqwest::Error) -> bool {
    let mut source = error.source();
    while let Some(cause) = source {
        if is_invalid_certificate(cause) {
            return true;
        }
        source = cause.source();
    }
    false
}

/// `io::Error`s wrapping a TLS error, nested, hide it from `source()`: unwrap them.
fn is_invalid_certificate(cause: &(dyn std::error::Error + 'static)) -> bool {
    if let Some(tls) = cause.downcast_ref::<rustls::Error>() {
        return matches!(tls, rustls::Error::InvalidCertificate(_));
    }
    cause
        .downcast_ref::<std::io::Error>()
        .and_then(std::io::Error::get_ref)
        .is_some_and(|inner| is_invalid_certificate(inner))
}

fn chain(error: &reqwest::Error) -> String {
    let mut text = error.to_string();
    let mut source = error.source();
    while let Some(cause) = source {
        text.push_str(": ");
        text.push_str(&cause.to_string());
        source = cause.source();
    }
    text
}

#[cfg(test)]
mod tests {
    use super::*;

    fn response(status: u16, body: &[u8]) -> Response {
        http::Response::builder().status(status).body(body.to_vec()).expect("response").into()
    }

    #[tokio::test]
    async fn a_body_of_exactly_the_cap_is_read() {
        let body = read_body(response(200, &[1; 8]), 8).await.expect("body");
        assert_eq!(body, [1; 8]);
    }

    #[tokio::test]
    async fn a_body_over_the_cap_is_refused() {
        let err = read_body(response(200, &[1; 9]), 8).await.expect_err("too large");
        assert!(matches!(err, GetError::TooLarge { max_bytes: 8 }), "{err:?}");
    }

    #[tokio::test]
    async fn a_zero_cap_accepts_only_an_empty_body() {
        assert_eq!(read_body(response(200, b""), 0).await.expect("empty").len(), 0);
        assert!(read_body(response(200, b"x"), 0).await.is_err());
    }

    #[tokio::test]
    async fn only_status_200_is_a_body() {
        for code in [204, 301, 404, 500] {
            let err = read_body(response(code, b"x"), 8).await.expect_err("refused");
            assert!(matches!(err, GetError::Status(c) if c == code), "{err:?}");
        }
    }

    #[test]
    fn a_nested_io_error_around_a_certificate_error_is_found() {
        let tls = rustls::Error::InvalidCertificate(rustls::CertificateError::Expired);
        let inner = std::io::Error::new(std::io::ErrorKind::InvalidData, tls);
        let outer = std::io::Error::other(inner);
        assert!(is_invalid_certificate(&outer));
    }

    #[test]
    fn other_errors_are_not_certificate_errors() {
        let tls = std::io::Error::other(rustls::Error::HandshakeNotComplete);
        assert!(!is_invalid_certificate(&tls));
        assert!(!is_invalid_certificate(&std::io::Error::other("closed")));
        assert!(!is_invalid_certificate(&std::fmt::Error));
    }

    #[tokio::test]
    async fn a_malformed_root_is_refused() {
        let junk = CertificateDer::from(vec![0u8; 4]);
        let err = get_with_roots(
            "https://localhost/",
            Limits { timeout: Duration::from_secs(1), max_bytes: 1 },
            &[junk],
        )
        .await
        .expect_err("refused");
        assert!(matches!(err, GetError::Certificate(_)), "{err:?}");
    }

    #[tokio::test]
    async fn a_refused_connection_names_its_cause() {
        let port = {
            let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind");
            listener.local_addr().expect("addr").port()
        };
        let limits = Limits { timeout: Duration::from_secs(5), max_bytes: 1 };
        let err = get(&format!("https://127.0.0.1:{port}/"), limits).await.expect_err("refused");
        assert!(matches!(&err, GetError::Connect(text) if text.contains(": ")), "{err:?}");
    }
}
