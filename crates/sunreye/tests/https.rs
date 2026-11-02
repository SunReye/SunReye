//! The HTTPS stack against a local TLS server whose root is the test's own.

#![allow(clippy::expect_used, reason = "helpers outside #[test] fns may panic like the tests")]

use std::collections::BTreeMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use sunreye::https::{GetError, Limits, get, get_with_roots};
use tokio::io::AsyncWriteExt;
use tokio::net::{TcpListener, TcpStream};
use tokio_rustls::TlsAcceptor;
use tokio_rustls::rustls::pki_types::{CertificateDer, PrivateKeyDer};

mod support;
use support::{Ca, Instead, Site, read_request, serve_site_with};

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
    let acceptor = support::acceptor(chain);
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

#[tokio::test]
async fn a_redirect_is_not_followed_even_within_the_same_origin() {
    let ca = Ca::new("test root");
    let mut files = Site::new();
    files.insert("/final.json".into(), b"reached".to_vec());
    let instead = BTreeMap::from([("/start.json".to_owned(), Instead::Redirect("/final.json".into()))]);
    let port = serve_site_with(&ca, files, instead).await;
    let url = format!("https://localhost:{port}/start.json");
    let err = get_with_roots(&url, limits(1024), &[ca.root()]).await.expect_err("redirect");
    assert!(matches!(err, GetError::Status(302)), "{err:?}");
}
