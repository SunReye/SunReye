//! A local TLS server's pieces: a certificate authority of the test's own, the acceptor it signs for and
//! the request head reader. Included by the tests that serve HTTPS.

#![allow(clippy::expect_used, reason = "helpers outside #[test] fns may panic like the tests")]
#![allow(dead_code, reason = "each test file uses a part of this module")]

use std::collections::BTreeMap;
use std::sync::Arc;

use rcgen::{BasicConstraints, CertificateParams, DnType, IsCa, Issuer, KeyPair, KeyUsagePurpose};
use serde_json::{Value, json};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio_rustls::TlsAcceptor;
use tokio_rustls::rustls::pki_types::{CertificateDer, PrivateKeyDer};
use tokio_rustls::rustls::{ServerConfig, crypto::ring::default_provider};

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

pub async fn serve_site(ca: &Ca, site: Site) -> u16 {
    let acceptor = acceptor(ca.leaf("localhost"));
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
    let port = listener.local_addr().expect("addr").port();
    let site = Arc::new(site);
    tokio::spawn(async move {
        while let Ok((tcp, _)) = listener.accept().await {
            tokio::spawn(answer(acceptor.clone(), tcp, Arc::clone(&site)));
        }
    });
    port
}

async fn answer(acceptor: TlsAcceptor, tcp: TcpStream, site: Arc<Site>) {
    let Ok(mut tls) = acceptor.accept(tcp).await else { return };
    let Some(request) = read_request(&mut tls).await else { return };
    let head = String::from_utf8_lossy(&request);
    let path = head.split_whitespace().nth(1).unwrap_or_default();
    let wire = match site.get(path) {
        Some(body) => {
            let mut wire =
                format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len())
                    .into_bytes();
            wire.extend_from_slice(body);
            wire
        }
        None => b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".to_vec(),
    };
    let _ = tls.write_all(&wire).await;
    let _ = tls.shutdown().await;
}
