//! A fake index host and test signing keys: tests never reach the network or a release key.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, PoisonError};

use ring::digest::{SHA256, digest};
use ring::rand::SystemRandom;
use ring::signature::{Ed25519KeyPair, KeyPair};
use serde_json::{Value, json};

use super::{Fetch, Keys};

/// Serves files by URL and records each fetch.
#[derive(Debug, Default)]
pub struct Host {
    files: Mutex<HashMap<String, Vec<u8>>>,
    fetched: Mutex<Vec<String>>,
}

impl Host {
    pub fn new() -> Arc<Self> {
        Arc::default()
    }

    pub fn serve(&self, url: &str, bytes: impl Into<Vec<u8>>) {
        self.files
            .lock()
            .unwrap()
            .insert(url.to_owned(), bytes.into());
    }

    pub fn fetched(&self) -> Vec<String> {
        self.fetched.lock().unwrap().clone()
    }
}

impl Fetch for Host {
    fn get(&self, url: &str) -> Result<Vec<u8>, String> {
        self.fetched
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .push(url.to_owned());
        let file = self
            .files
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .get(url)
            .cloned();
        file.ok_or_else(|| format!("{url}: not found"))
    }
}

/// A profile key pair and its backup, generated per test.
pub struct Signer {
    pub active: Ed25519KeyPair,
    pub backup: Ed25519KeyPair,
}

impl Default for Signer {
    fn default() -> Self {
        let pair = || {
            let pkcs8 = Ed25519KeyPair::generate_pkcs8(&SystemRandom::new()).unwrap();
            Ed25519KeyPair::from_pkcs8(pkcs8.as_ref()).unwrap()
        };
        Self {
            active: pair(),
            backup: pair(),
        }
    }
}

impl Signer {
    pub fn keys(&self) -> Keys {
        let key = |pair: &Ed25519KeyPair| pair.public_key().as_ref().try_into().unwrap();
        Keys {
            active: key(&self.active),
            backup: key(&self.backup),
        }
    }

    /// The index's revocation of the active key, signed by `by`.
    pub fn revocation(&self, by: &Ed25519KeyPair) -> Value {
        let key = self.active.public_key().as_ref();
        json!({ "key": hex(key), "signature": hex(by.sign(key).as_ref()) })
    }
}

/// The index entry for `bytes` hosted at `url`, signed by `by` when given.
pub fn entry(bytes: &[u8], url: &str, by: Option<&Ed25519KeyPair>) -> Value {
    let profile: Value = serde_json::from_slice(bytes).unwrap();
    let mut entry = json!({
        "id": profile["id"], "version": profile["version"], "schema": profile["schema"],
        "requires": profile["requires"], "sha256": hex(digest(&SHA256, bytes).as_ref()),
        "url": url,
    });
    if let Some(pair) = by {
        entry["signature"] = json!(hex(pair.sign(bytes).as_ref()));
    }
    entry
}

pub fn hex(bytes: &[u8]) -> String {
    bytes
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect::<Vec<_>>()
        .concat()
}
