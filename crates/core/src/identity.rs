//! The core's identity (ADR 16): its install id and its static X25519 key, created at first run.
//!
//! The identity module owns the `identity` and `trusted_key` tables. The private key is read by
//! nothing yet and never leaves the store but in a backup, so no response or log line can hold it.

use rusqlite::{Connection, OptionalExtension, params};
use x25519_dalek::{PublicKey, StaticSecret};

use crate::storage::{Database, Error};

/// The install's identity, without its private key.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Identity {
    install: String,
    public: [u8; 32],
}

impl Identity {
    /// The install's identity, created at first run.
    ///
    /// # Errors
    /// No randomness, or the store cannot be read or written.
    pub async fn open(database: &Database) -> Result<Self, Error> {
        database.run(load_or_create).await
    }

    /// The install id: a version 4 UUID.
    #[must_use]
    pub fn install_id(&self) -> &str {
        &self.install
    }

    /// The public half of the core's static key, which a client pins.
    #[must_use]
    pub const fn public_key(&self) -> [u8; 32] {
        self.public
    }
}

fn load_or_create(db: &Connection) -> rusqlite::Result<Identity> {
    let stored = |db: &Connection| {
        db.query_row(
            "SELECT install, static_key FROM identity WHERE id = 1",
            [],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, [u8; 32]>(1)?)),
        )
        .optional()
    };
    let (install, key) = if let Some(stored) = stored(db)? {
        stored
    } else {
        let (install, key) = (uuid(random()?), random()?);
        db.execute(
            "INSERT INTO identity (id, install, static_key) VALUES (1, ?1, ?2)",
            params![install, key],
        )?;
        (install, key)
    };
    let public = PublicKey::from(&StaticSecret::from(key)).to_bytes();
    Ok(Identity { install, public })
}

fn random<const N: usize>() -> rusqlite::Result<[u8; N]> {
    let mut bytes = [0; N];
    getrandom::fill(&mut bytes)
        .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
    Ok(bytes)
}

/// `bytes` as a version 4 UUID (RFC 9562).
fn uuid(bytes: [u8; 16]) -> String {
    use std::fmt::Write as _;
    let mut text = String::with_capacity(36);
    for (i, &b) in bytes.iter().enumerate() {
        if matches!(i, 4 | 6 | 8 | 10) {
            text.push('-');
        }
        let b = match i {
            6 => (b & 0x0f) | 0x40,
            8 => (b & 0x3f) | 0x80,
            _ => b,
        };
        write!(text, "{b:02x}").ok();
    }
    text
}

#[cfg(test)]
mod tests;
