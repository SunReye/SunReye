//! Which key signs official profiles (ADR 8): the active key until the backup revokes it.

use ring::signature::{ED25519, UnparsedPublicKey};

/// The profile key and its offline backup: Ed25519 public keys.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Keys {
    pub active: [u8; 32],
    pub backup: [u8; 32],
}

/// The compiled-in profile keys. `None` until the owner's key ceremony sets them; until then no
/// fetched profile verifies as official and the embedded snapshot is the only official source.
pub const KEYS: Option<Keys> = None;

/// The keys and whether the active one has been revoked.
#[derive(Debug, Clone, Copy)]
pub struct Trust {
    pub keys: Option<Keys>,
    pub revoked: bool,
}

impl Trust {
    /// Whether `signature` is the trusted key's over exactly `bytes`.
    pub fn verifies(&self, bytes: &[u8], signature: &[u8]) -> bool {
        self.keys.is_some_and(|keys| {
            let key = if self.revoked {
                keys.backup
            } else {
                keys.active
            };
            verify(&key, bytes, signature)
        })
    }

    /// Whether a revocation of `key` is the backup's signature over the active key's bytes.
    pub fn revokes(&self, key: &[u8], signature: &[u8]) -> bool {
        self.keys
            .is_some_and(|keys| key == keys.active && verify(&keys.backup, key, signature))
    }
}

fn verify(key: &[u8; 32], bytes: &[u8], signature: &[u8]) -> bool {
    UnparsedPublicKey::new(&ED25519, key)
        .verify(bytes, signature)
        .is_ok()
}

/// Lowercase or uppercase hex to bytes.
pub fn unhex(text: &str) -> Option<Vec<u8>> {
    if !text.len().is_multiple_of(2) {
        return None;
    }
    (0..text.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(text.get(i..i + 2)?, 16).ok())
        .collect()
}
