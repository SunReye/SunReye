//! The index file (ADR 8): what it lists, and whether this build can load an entry.

use serde::Deserialize;
use sunreye_profile::SUPPORT;

/// A hosted `index.json`. Unknown fields are ignored: an index serves cores of several releases.
#[derive(Debug, Deserialize)]
pub struct Index {
    pub profiles: Vec<Listed>,
    pub revocation: Option<Revocation>,
}

/// One profile file an index lists.
#[derive(Debug, Deserialize)]
pub struct Listed {
    pub id: String,
    pub version: String,
    pub schema: u32,
    pub requires: Vec<String>,
    /// Hex SHA-256 of the file's exact bytes.
    pub sha256: String,
    /// Absolute, or relative to the index's own URL.
    pub url: String,
    /// Hex Ed25519 signature over the file's exact bytes; absent from a community index.
    pub signature: Option<String>,
}

/// The backup key's signature over the revoked active key's 32 bytes, both hex.
#[derive(Debug, Deserialize)]
pub struct Revocation {
    pub key: String,
    pub signature: String,
}

/// Whether this build can load an entry, by its schema and required capabilities.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Fit {
    Loads,
    NewerCore,
    OldSchema,
}

impl Listed {
    pub fn fit(&self) -> Fit {
        let lacks = self
            .requires
            .iter()
            .any(|name| !SUPPORT.capabilities.contains(&name.as_str()));
        if self.schema > SUPPORT.schema.max || lacks {
            Fit::NewerCore
        } else if self.schema < SUPPORT.schema.min {
            Fit::OldSchema
        } else {
            Fit::Loads
        }
    }

    /// The file's URL, resolved against `index`'s.
    pub fn resolve(&self, index: &str) -> String {
        if self.url.contains("://") {
            return self.url.clone();
        }
        let base = index.rsplit_once('/').map_or(index, |(base, _)| base);
        format!("{base}/{}", self.url)
    }
}

/// A profile's semver: `major.minor.patch`, compared numerically.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct Version(u64, u64, u64);

impl Version {
    pub const ZERO: Self = Self(0, 0, 0);

    pub fn parse(text: &str) -> Option<Self> {
        let mut parts = text.split('.').map(|part| part.parse().ok());
        let version = Self(parts.next()??, parts.next()??, parts.next()??);
        parts.next().is_none().then_some(version)
    }
}
