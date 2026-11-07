//! A local TLS server's pieces: a certificate authority of the test's own, the acceptor it signs for and
//! the request head reader. Included by the tests that serve HTTPS.

#![allow(clippy::expect_used, reason = "helpers outside #[test] fns may panic like the tests")]
#![allow(dead_code, reason = "each test file uses a part of this module")]

use std::collections::BTreeMap;
use std::ops::Deref;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use rcgen::{BasicConstraints, CertificateParams, DnType, IsCa, Issuer, KeyPair, KeyUsagePurpose};
use serde_json::{Value, json};
use sunreye_sim::{FC_READ_HOLDING, Framing, Registers, Simulator};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio_rustls::TlsAcceptor;
use tokio_rustls::rustls::pki_types::{CertificateDer, PrivateKeyDer};
use tokio_rustls::rustls::{ServerConfig, crypto::ring::default_provider};

/// The fetch address of a test core: accepts, counts and closes every connection, so nothing leaves the host,
/// a fetch fails at once and a test reads how often one was dialled. Its thread lives until the process ends.
pub struct Offline {
    pub url: String,
    dials: Arc<AtomicUsize>,
}

impl Offline {
    pub fn start() -> Self {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind");
        let url = format!("https://{}/", listener.local_addr().expect("addr"));
        let dials = Arc::new(AtomicUsize::new(0));
        let counted = Arc::clone(&dials);
        std::thread::spawn(move || {
            for tcp in listener.incoming() {
                // Counted before the close the dialling fetch waits on.
                counted.fetch_add(1, Ordering::SeqCst);
                drop(tcp);
            }
        });
        Self { url, dials }
    }

    /// The one address every test core without its own stand-in fetches from.
    pub fn shared() -> &'static Self {
        static SHARED: std::sync::OnceLock<Offline> = std::sync::OnceLock::new();
        SHARED.get_or_init(Self::start)
    }

    pub fn dials(&self) -> usize {
        self.dials.load(Ordering::SeqCst)
    }
}

pub struct Ca {
    params: CertificateParams,
    cert: rcgen::Certificate,
    key: KeyPair,
}

impl Ca {
    pub fn new(name: &str) -> Self {
        let mut params = CertificateParams::new(Vec::new()).expect("params");
        params.distinguished_name.push(DnType::CommonName, name);
        params.is_ca = IsCa::Ca(BasicConstraints::Unconstrained);
        params.key_usages = vec![KeyUsagePurpose::KeyCertSign];
        let key = KeyPair::generate().expect("key");
        let cert = params.self_signed(&key).expect("self-signed");
        Self { params, cert, key }
    }

    pub fn root(&self) -> CertificateDer<'static> {
        self.cert.der().clone()
    }

    /// A leaf for `host`, signed by this CA.
    pub fn leaf(&self, host: &str) -> (CertificateDer<'static>, PrivateKeyDer<'static>) {
        let params = CertificateParams::new(vec![host.to_owned()]).expect("params");
        let key = KeyPair::generate().expect("key");
        let issuer = Issuer::from_params(&self.params, &self.key);
        let cert = params.signed_by(&key, &issuer).expect("leaf");
        (cert.der().clone(), PrivateKeyDer::try_from(key.serialize_der()).expect("pkcs8"))
    }
}

/// An acceptor presenting `chain`.
pub fn acceptor(chain: (CertificateDer<'static>, PrivateKeyDer<'static>)) -> TlsAcceptor {
    let config = ServerConfig::builder_with_provider(Arc::new(default_provider()))
        .with_safe_default_protocol_versions()
        .expect("versions")
        .with_no_client_auth()
        .with_single_cert(vec![chain.0], chain.1)
        .expect("server config");
    TlsAcceptor::from(Arc::new(config))
}

/// Reads up to the blank line ending the request head.
pub async fn read_request<R: AsyncReadExt + Unpin>(input: &mut R) -> Option<Vec<u8>> {
    let mut request = Vec::new();
    let mut buf = [0u8; 1024];
    while !request.ends_with(b"\r\n\r\n") {
        let n = input.read(&mut buf).await.ok().filter(|n| *n > 0)?;
        request.extend_from_slice(&buf[..n]);
    }
    Some(request)
}

const OFFICIAL: &str = include_str!("../../profiles/official.json");

/// The profile objects of the compiled-in set, as the repository serves them.
pub fn official_files() -> Vec<(String, Value)> {
    let bundle: Value = serde_json::from_str(OFFICIAL).expect("bundle json");
    bundle["profiles"]
        .as_array()
        .expect("profiles")
        .iter()
        .map(|pinned| (pinned["profile"]["id"].as_str().expect("id").to_owned(), pinned["profile"].clone()))
        .collect()
}

pub fn index_of(files: &[(String, Value)]) -> Value {
    let entries: Vec<Value> = files
        .iter()
        .map(|(id, profile)| {
            json!({
                "id": id, "name": profile["name"], "manufacturer": profile["manufacturer"],
                "version": profile["version"], "path": format!("profiles/{id}.json")
            })
        })
        .collect();
    json!({"name": "test repo", "profiles": entries})
}

/// A repository of files by absolute URL path.
pub type Site = BTreeMap<String, Vec<u8>>;

pub fn site(files: &[(String, Value)]) -> Site {
    let mut site = Site::new();
    site.insert("/repo/index.json".into(), index_of(files).to_string().into_bytes());
    for (id, profile) in files {
        site.insert(format!("/repo/profiles/{id}.json"), profile.to_string().into_bytes());
    }
    site
}

/// What a path answers instead of its file.
#[derive(Clone)]
pub enum Instead {
    /// 302 to this absolute URL.
    Redirect(String),
    /// Reads the request and never answers.
    Stall,
}

pub async fn serve_site(ca: &Ca, site: Site) -> u16 {
    serve_site_with(ca, site, BTreeMap::new()).await
}

/// [`serve_site`] where the paths in `instead` answer as told.
pub async fn serve_site_with(ca: &Ca, site: Site, instead: BTreeMap<String, Instead>) -> u16 {
    let acceptor = acceptor(ca.leaf("localhost"));
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
    let port = listener.local_addr().expect("addr").port();
    let site = Arc::new((site, instead));
    tokio::spawn(async move {
        while let Ok((tcp, _)) = listener.accept().await {
            tokio::spawn(answer(acceptor.clone(), tcp, Arc::clone(&site)));
        }
    });
    port
}

async fn answer(acceptor: TlsAcceptor, tcp: TcpStream, site: Arc<(Site, BTreeMap<String, Instead>)>) {
    let Ok(mut tls) = acceptor.accept(tcp).await else { return };
    let Some(request) = read_request(&mut tls).await else { return };
    let head = String::from_utf8_lossy(&request);
    let path = head.split_whitespace().nth(1).unwrap_or_default();
    let (files, instead) = &*site;
    let wire = match (instead.get(path), files.get(path)) {
        (Some(Instead::Stall), _) => return stall().await,
        (Some(Instead::Redirect(to)), _) => {
            format!("HTTP/1.1 302 Found\r\nLocation: {to}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
                .into_bytes()
        }
        (None, Some(body)) => {
            let mut wire =
                format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len())
                    .into_bytes();
            wire.extend_from_slice(body);
            wire
        }
        (None, None) => b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".to_vec(),
    };
    let _ = tls.write_all(&wire).await;
    let _ = tls.shutdown().await;
}

async fn stall() {
    std::future::pending::<()>().await;
}

/// A [`Simulator`] that fails the test owning it, when dropped, if the core wrote to it: ADR 0005, the core
/// only reads.
#[derive(Debug)]
pub struct Sim(Simulator);

impl Sim {
    pub async fn start(registers: Registers, units: &[u8]) -> Self {
        Self::start_with(Framing::Tcp, registers, units).await
    }

    pub async fn start_with(framing: Framing, registers: Registers, units: &[u8]) -> Self {
        Self(Simulator::start_with(framing, registers, units).await.expect("simulator"))
    }
}

impl Deref for Sim {
    type Target = Simulator;

    fn deref(&self) -> &Simulator {
        &self.0
    }
}

impl Drop for Sim {
    fn drop(&mut self) {
        let writes: Vec<_> = self.requests().into_iter().filter(|r| r.function != FC_READ_HOLDING).collect();
        if !std::thread::panicking() {
            assert!(writes.is_empty(), "the core wrote to the simulator (ADR 0005): {writes:?}");
        }
    }
}
