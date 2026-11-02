//! The HTTPS stack against a local TLS server whose root is the test's own.

#![allow(clippy::expect_used, reason = "helpers outside #[test] fns may panic like the tests")]

use std::sync::Arc;
use std::time::{Duration, Instant};

use rcgen::{BasicConstraints, CertificateParams, DnType, IsCa, Issuer, KeyPair, KeyUsagePurpose};
use sunreye::https::{GetError, Limits, get, get_with_roots};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio_rustls::TlsAcceptor;
use tokio_rustls::rustls::pki_types::{CertificateDer, PrivateKeyDer};
use tokio_rustls::rustls::{ServerConfig, crypto::ring::default_provider};

struct Ca {
    params: CertificateParams,
    cert: rcgen::Certificate,
    key: KeyPair,
}

impl Ca {
    fn new(name: &str) -> Self {
        let mut params = CertificateParams::new(Vec::new()).expect("params");
        params.distinguished_name.push(DnType::CommonName, name);
        params.is_ca = IsCa::Ca(BasicConstraints::Unconstrained);
        params.key_usages = vec![KeyUsagePurpose::KeyCertSign];
        let key = KeyPair::generate().expect("key");
        let cert = params.self_signed(&key).expect("self-signed");
        Self { params, cert, key }
    }

    fn root(&self) -> CertificateDer<'static> {
        self.cert.der().clone()
    }

    /// A leaf for `host`, signed by this CA.
    fn leaf(&self, host: &str) -> (CertificateDer<'static>, PrivateKeyDer<'static>) {
        let params = CertificateParams::new(vec![host.to_owned()]).expect("params");
        let key = KeyPair::generate().expect("key");
        let issuer = Issuer::from_params(&self.params, &self.key);
        let cert = params.signed_by(&key, &issuer).expect("leaf");
        (cert.der().clone(), PrivateKeyDer::try_from(key.serialize_der()).expect("pkcs8"))
    }
}

enum Reply {
    /// 200 with a `Content-Length` matching the body.
    Body(Vec<u8>),
    /// 200 with no length: the body ends when the connection closes.
    Unbounded(Vec<u8>),
    /// Announces `length` bytes, sends a few, then stalls.
    Announces(u64),
    Status(u16),
    /// Reads the request and never answers.
    Silence,
}

/// Serves one `reply` per connection on a free port; returns the port.
async fn serve(chain: (CertificateDer<'static>, PrivateKeyDer<'static>), reply: Reply) -> u16 {
    let config = ServerConfig::builder_with_provider(Arc::new(default_provider()))
        .with_safe_default_protocol_versions()
        .expect("versions")
        .with_no_client_auth()
        .with_single_cert(vec![chain.0], chain.1)
        .expect("server config");
    let acceptor = TlsAcceptor::from(Arc::new(config));
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
    let port = listener.local_addr().expect("addr").port();
    tokio::spawn(accept_loop(listener, acceptor, Arc::new(reply)));
    port
}

async fn accept_loop(listener: TcpListener, acceptor: TlsAcceptor, reply: Arc<Reply>) {
    while let Ok((tcp, _)) = listener.accept().await {
        tokio::spawn(connection(acceptor.clone(), tcp, Arc::clone(&reply)));
    }
}

async fn connection(acceptor: TlsAcceptor, tcp: TcpStream, reply: Arc<Reply>) {
    let Ok(mut tls) = acceptor.accept(tcp).await else { return };
    if read_request(&mut tls).await.is_some() {
        let _ = respond(&mut tls, &reply).await;
    }
}

/// Reads up to the blank line ending the request head.
async fn read_request<R: AsyncReadExt + Unpin>(input: &mut R) -> Option<Vec<u8>> {
    let mut request = Vec::new();
    let mut buf = [0u8; 1024];
    while !request.ends_with(b"\r\n\r\n") {
        let n = input.read(&mut buf).await.ok().filter(|n| *n > 0)?;
        request.extend_from_slice(&buf[..n]);
    }
    Some(request)
}

/// What goes on the wire for a reply, and whether the connection then stalls instead of closing.
fn script(reply: &Reply) -> (Vec<u8>, bool) {
    let framed = |status: &str, body: &[u8]| {
        let mut wire = format!("HTTP/1.1 {status}\r\nConnection: close\r\n\r\n").into_bytes();
        wire.extend_from_slice(body);
        wire
    };
    match reply {
        Reply::Body(body) => (framed(&format!("200 OK\r\nContent-Length: {}", body.len()), body), false),
        Reply::Unbounded(body) => (framed("200 OK", body), false),
        Reply::Announces(length) => {
            (framed(&format!("200 OK\r\nContent-Length: {length}"), b"partial"), true)
        }
        Reply::Status(code) => (framed(&format!("{code} X\r\nContent-Length: 0"), b""), false),
        Reply::Silence => (Vec::new(), true),
    }
}

async fn respond<W: AsyncWriteExt + Unpin>(out: &mut W, reply: &Reply) -> std::io::Result<()> {
    let (wire, stalls) = script(reply);
    out.write_all(&wire).await?;
    out.flush().await?;
    if stalls {
        return stall().await;
    }
    out.shutdown().await
}

async fn stall() -> std::io::Result<()> {
    tokio::time::sleep(Duration::from_secs(60)).await;
    Ok(())
}

fn limits(max_bytes: usize) -> Limits {
    Limits { timeout: Duration::from_secs(5), max_bytes }
}

fn url(port: u16) -> String {
    format!("https://localhost:{port}/profile.json")
}

#[tokio::test]
async fn a_trusted_server_returns_its_body() {
    let ca = Ca::new("test root");
    let port = serve(ca.leaf("localhost"), Reply::Body(b"hello".to_vec())).await;
    let body = get_with_roots(&url(port), limits(1024), &[ca.root()]).await.expect("body");
    assert_eq!(body, b"hello");
}

#[tokio::test]
async fn an_empty_body_is_a_success() {
    let ca = Ca::new("test root");
    let port = serve(ca.leaf("localhost"), Reply::Body(Vec::new())).await;
    let body = get_with_roots(&url(port), limits(1024), &[ca.root()]).await.expect("body");
    assert_eq!(body.len(), 0);
}

#[tokio::test]
async fn a_body_of_exactly_the_cap_is_accepted() {
    let ca = Ca::new("test root");
    let port = serve(ca.leaf("localhost"), Reply::Body(vec![7; 1024])).await;
    let body = get_with_roots(&url(port), limits(1024), &[ca.root()]).await.expect("body");
    assert_eq!(body.len(), 1024);
}

#[tokio::test]
async fn one_byte_over_the_cap_is_refused() {
    let ca = Ca::new("test root");
    let port = serve(ca.leaf("localhost"), Reply::Body(vec![7; 1025])).await;
    let err = get_with_roots(&url(port), limits(1024), &[ca.root()]).await.expect_err("too large");
    assert!(matches!(err, GetError::TooLarge { max_bytes: 1024 }), "{err:?}");
}

#[tokio::test]
async fn an_unbounded_body_over_the_cap_is_refused() {
    let ca = Ca::new("test root");
    let port = serve(ca.leaf("localhost"), Reply::Unbounded(vec![7; 1 << 20])).await;
    let err = get_with_roots(&url(port), limits(1024), &[ca.root()]).await.expect_err("too large");
    assert!(matches!(err, GetError::TooLarge { max_bytes: 1024 }), "{err:?}");
}

#[tokio::test]
async fn an_announced_length_over_the_cap_is_refused_before_the_body_arrives() {
    let ca = Ca::new("test root");
    let port = serve(ca.leaf("localhost"), Reply::Announces(10 << 30)).await;
    let started = Instant::now();
    let err = get_with_roots(&url(port), limits(1024), &[ca.root()]).await.expect_err("too large");
    assert!(matches!(err, GetError::TooLarge { max_bytes: 1024 }), "{err:?}");
    assert!(started.elapsed() < Duration::from_secs(3), "waited for the body");
}

#[tokio::test]
async fn an_untrusted_issuer_is_a_certificate_error() {
    let trusted = Ca::new("trusted root");
    let rogue = Ca::new("rogue root");
    let port = serve(rogue.leaf("localhost"), Reply::Body(b"x".to_vec())).await;
    let err = get_with_roots(&url(port), limits(1024), &[trusted.root()]).await.expect_err("refused");
    assert!(matches!(err, GetError::Certificate(_)), "{err:?}");
}

#[tokio::test]
async fn a_certificate_for_another_host_is_a_certificate_error() {
    let ca = Ca::new("test root");
    let port = serve(ca.leaf("other.example"), Reply::Body(b"x".to_vec())).await;
    let err = get_with_roots(&url(port), limits(1024), &[ca.root()]).await.expect_err("refused");
    assert!(matches!(err, GetError::Certificate(_)), "{err:?}");
}

#[tokio::test]
async fn a_test_root_is_unknown_to_the_default_trust_store() {
    let ca = Ca::new("test root");
    let port = serve(ca.leaf("localhost"), Reply::Body(b"x".to_vec())).await;
    let err = get(&url(port), limits(1024)).await.expect_err("refused");
    assert!(matches!(err, GetError::Certificate(_)), "{err:?}");
}

#[tokio::test]
async fn a_silent_server_times_out() {
    let ca = Ca::new("test root");
    let port = serve(ca.leaf("localhost"), Reply::Silence).await;
    let limits = Limits { timeout: Duration::from_millis(300), max_bytes: 1024 };
    let started = Instant::now();
    let err = get_with_roots(&url(port), limits, &[ca.root()]).await.expect_err("timeout");
    assert!(matches!(err, GetError::Timeout), "{err:?}");
    assert!(started.elapsed() < Duration::from_secs(3));
}

#[tokio::test]
async fn a_stalled_body_times_out() {
    let ca = Ca::new("test root");
    let port = serve(ca.leaf("localhost"), Reply::Announces(100)).await;
    let limits = Limits { timeout: Duration::from_millis(300), max_bytes: 1024 };
    let err = get_with_roots(&url(port), limits, &[ca.root()]).await.expect_err("timeout");
    assert!(matches!(err, GetError::Timeout), "{err:?}");
}

#[tokio::test]
async fn a_non_success_status_is_reported() {
    let ca = Ca::new("test root");
    let port = serve(ca.leaf("localhost"), Reply::Status(404)).await;
    let err = get_with_roots(&url(port), limits(1024), &[ca.root()]).await.expect_err("404");
    assert!(matches!(err, GetError::Status(404)), "{err:?}");
}

#[tokio::test]
async fn a_closed_port_is_a_connect_error() {
    let port = {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        listener.local_addr().expect("addr").port()
    };
    let err = get(&url(port), limits(1024)).await.expect_err("refused");
    assert!(matches!(err, GetError::Connect(_)), "{err:?}");
}

#[tokio::test]
async fn plain_http_is_refused() {
    let err = get("http://localhost:1/", limits(1024)).await.expect_err("refused");
    assert!(matches!(err, GetError::Url(_)), "{err:?}");
}

#[tokio::test]
async fn a_malformed_url_is_refused() {
    let err = get("not a url", limits(1024)).await.expect_err("refused");
    assert!(matches!(err, GetError::Url(_)), "{err:?}");
}

/// Live network: `cargo test -p sunreye --test https -- --ignored`.
#[tokio::test]
#[ignore = "needs the internet"]
async fn live_energy_charts_answers() {
    let body = get("https://api.energy-charts.info/", limits(4 << 20)).await.expect("energy-charts");
    assert_ne!(body.len(), 0);
}

#[tokio::test]
#[ignore = "needs the internet"]
async fn live_raw_github_file_is_served() {
    let body = get("https://raw.githubusercontent.com/rust-lang/rust/master/LICENSE-MIT", limits(1 << 20))
        .await
        .expect("raw.githubusercontent.com");
    assert!(String::from_utf8_lossy(&body).contains("Permission is hereby granted"));
}
