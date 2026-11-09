//! The profiles the core can read devices with (ADR 8): the official snapshot bundled at build
//! time, and profiles fetched from an index on an admin's action, verified and kept as the last
//! good copy.
//!
//! The profiles module owns the `profile_index`, `fetched_profile` and `profile_key_revoked`
//! tables. It never fetches on its own: only adding an index or checking for updates does.

#[cfg(test)]
pub(crate) mod fake;
mod fetch;
mod index;
mod routes;
mod store;
mod trust;

use std::collections::HashMap;
use std::sync::{Arc, PoisonError, RwLock};
use std::time::SystemTime;

use ring::digest::{SHA256, digest};
use serde::Serialize;
use sunreye_profile::{LoadError, Profile};
use tokio::sync::Mutex;
use utoipa::ToSchema;

use crate::api::{Code, Problem};
use crate::storage::{self, Database};
use index::{Fit, Index, Listed, Version};
use store::Fetched;
use trust::{Trust, unhex};

pub use fetch::{Fetch, Https};
pub use trust::{KEYS, Keys};

/// The official index, served by GitHub Pages from the `profiles-dist` branch.
pub const OFFICIAL_INDEX: &str = "https://sunreye.github.io/SunReye/index.json";

/// The official profiles, as `profiles/` holds them at build time.
const BUNDLED: &[&str] = &[include_str!("../../../profiles/deye-sg05lp3.json")];

const INTERNAL: Problem = Problem {
    status: axum::http::StatusCode::INTERNAL_SERVER_ERROR,
    code: Code::Internal,
};

/// A loaded profile and whether it is official.
#[derive(Debug, Clone)]
struct Held {
    profile: Arc<Profile>,
    official: bool,
}

impl Held {
    fn version(&self) -> Version {
        Version::parse(&self.profile.version).unwrap_or(Version::ZERO)
    }

    /// Whether `self` should serve in place of `current`: an official profile is never replaced
    /// by a community one, and otherwise only by a higher semver.
    fn replaces(&self, current: Option<&Self>) -> bool {
        current.is_none_or(|current| match (current.official, self.official) {
            (true, false) => false,
            (false, true) => true,
            _ => self.version() > current.version(),
        })
    }
}

type Served = HashMap<String, Held>;

/// The profiles served, by id; clones share one catalogue, so a fetched profile reaches every
/// holder.
#[derive(Debug, Clone, Default)]
pub struct Catalogue(Arc<RwLock<Served>>);

impl Catalogue {
    /// Loads the bundled profiles.
    ///
    /// # Errors
    /// A bundled profile does not load in this build.
    pub fn bundled() -> Result<Self, LoadError> {
        Ok(Self(Arc::new(RwLock::new(bundled()?))))
    }

    #[must_use]
    pub fn get(&self, id: &str) -> Option<Arc<Profile>> {
        self.held(id).map(|held| held.profile)
    }

    /// Whether profile `id` is official: bundled, or its signature verifies (ADR 8).
    #[must_use]
    pub fn official(&self, id: &str) -> bool {
        self.held(id).is_some_and(|held| held.official)
    }

    fn held(&self, id: &str) -> Option<Held> {
        let profiles = self.0.read().unwrap_or_else(PoisonError::into_inner);
        profiles.get(id).cloned()
    }

    fn replace(&self, profiles: Served) {
        *self.0.write().unwrap_or_else(PoisonError::into_inner) = profiles;
    }

    fn insert(&self, held: Held) {
        let mut profiles = self.0.write().unwrap_or_else(PoisonError::into_inner);
        profiles.insert(held.profile.id.clone(), held);
    }
}

fn bundled() -> Result<Served, LoadError> {
    BUNDLED
        .iter()
        .map(|json| {
            let profile = Arc::new(Profile::load(json)?);
            let held = Held {
                profile,
                official: true,
            };
            Ok((held.profile.id.clone(), held))
        })
        .collect()
}

/// What became of one entry of an index.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "kebab-case")]
pub enum Status {
    /// Verified, loaded and now served.
    Loaded,
    /// The version served is the same or higher; not downloaded.
    Current,
    /// Its schema is above this core's range or it needs a capability this core lacks; not
    /// downloaded.
    NewerCore,
    /// Its schema is below this core's range; not downloaded.
    OldSchema,
    /// The file could not be fetched.
    Unreachable,
    /// The file's SHA-256 is not the index's.
    Hash,
    /// No official signature, so it cannot replace an official profile.
    Signature,
    /// The file is not a profile this core loads, or not the one the index lists.
    Invalid,
}

/// One entry of an index and what became of it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct Offer {
    pub id: String,
    pub version: String,
    pub status: Status,
}

/// Why an index could not be read.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "kebab-case")]
pub enum IndexProblem {
    Unreachable,
    /// The file is not an index.
    Format,
}

/// An index and the outcome of its last check.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct Report {
    pub url: String,
    /// The built-in official index.
    pub official: bool,
    /// Whether it was checked since the core started.
    pub checked: bool,
    pub problem: Option<IndexProblem>,
    pub profiles: Vec<Offer>,
}

impl Report {
    fn unchecked(url: String) -> Self {
        Self {
            official: url == OFFICIAL_INDEX,
            url,
            checked: false,
            problem: None,
            profiles: Vec::new(),
        }
    }
}

/// The profiles feature module; clones share one state.
#[derive(Clone)]
pub struct Profiles {
    database: Database,
    catalogue: Catalogue,
    fetch: Arc<dyn Fetch>,
    /// Held across a check, so checks apply in order.
    state: Arc<Mutex<State>>,
}

struct State {
    trust: Trust,
    reports: HashMap<String, Report>,
}

impl std::fmt::Debug for Profiles {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Profiles").finish_non_exhaustive()
    }
}

/// Why the profiles could not be opened.
#[derive(Debug)]
pub enum Error {
    Storage(storage::Error),
    /// A bundled profile does not load in this build.
    Bundled(LoadError),
}

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Storage(e) => write!(f, "storage: {e}"),
            Self::Bundled(e) => write!(f, "bundled profile: {e}"),
        }
    }
}

impl std::error::Error for Error {}

impl Profiles {
    /// Serves the bundled snapshot and every stored copy that verifies; fetches nothing.
    ///
    /// # Errors
    /// The file cannot be read, or a bundled profile does not load in this build.
    pub async fn open(
        database: Database,
        fetch: Arc<dyn Fetch>,
        keys: Option<Keys>,
    ) -> Result<Self, Error> {
        let revoked = database.run(store::revoked).await.map_err(Error::Storage)?;
        let profiles = Self {
            database,
            catalogue: Catalogue::default(),
            fetch,
            state: Arc::new(Mutex::new(State {
                trust: Trust { keys, revoked },
                reports: HashMap::new(),
            })),
        };
        let trust = profiles.state.lock().await.trust;
        profiles.reload(trust).await?;
        Ok(profiles)
    }

    /// The profiles served; it follows every check.
    #[must_use]
    pub fn catalogue(&self) -> Catalogue {
        self.catalogue.clone()
    }

    /// The official index, then each added one, with the outcome of its last check.
    ///
    /// # Errors
    /// The file cannot be read.
    pub async fn indexes(&self) -> Result<Vec<Report>, Problem> {
        let urls = self.urls().await.map_err(|_| INTERNAL)?;
        let state = self.state.lock().await;
        Ok(urls
            .into_iter()
            .map(|url| {
                state
                    .reports
                    .get(&url)
                    .cloned()
                    .unwrap_or_else(|| Report::unchecked(url))
            })
            .collect())
    }

    /// Adds the index at `url` and checks it.
    ///
    /// # Errors
    /// `url` is not an HTTP(S) URL, or the file cannot be written.
    pub async fn add(&self, url: String, changed: SystemTime) -> Result<Report, Problem> {
        if !(url.starts_with("https://") || url.starts_with("http://")) {
            return Err(Problem {
                status: axum::http::StatusCode::UNPROCESSABLE_ENTITY,
                code: Code::IndexValue,
            });
        }
        if url != OFFICIAL_INDEX {
            let stored = url.clone();
            self.database
                .run(move |db| store::add_index(db, &stored, changed))
                .await
                .map_err(|_| INTERNAL)?;
        }
        let mut state = self.state.lock().await;
        self.check_index(&mut state, url).await
    }

    /// Checks every index for updates, the official one first.
    ///
    /// # Errors
    /// The file cannot be read or written.
    pub async fn check(&self) -> Result<Vec<Report>, Problem> {
        let urls = self.urls().await.map_err(|_| INTERNAL)?;
        let mut state = self.state.lock().await;
        let mut reports = Vec::with_capacity(urls.len());
        for url in urls {
            reports.push(self.check_index(&mut state, url).await?);
        }
        Ok(reports)
    }

    async fn urls(&self) -> Result<Vec<String>, storage::Error> {
        let added = self.database.run(store::indexes).await?;
        Ok(std::iter::once(OFFICIAL_INDEX.to_owned())
            .chain(added)
            .collect())
    }

    async fn check_index(&self, state: &mut State, url: String) -> Result<Report, Problem> {
        let mut report = Report::unchecked(url);
        report.checked = true;
        match self.get(&report.url).await {
            Err(()) => report.problem = Some(IndexProblem::Unreachable),
            Ok(bytes) => match serde_json::from_slice::<Index>(&bytes) {
                Err(_) => report.problem = Some(IndexProblem::Format),
                Ok(index) => {
                    self.revoke(state, &index).await?;
                    for listed in &index.profiles {
                        let status = self.offer(state.trust, &report.url, listed).await?;
                        report.profiles.push(Offer {
                            id: listed.id.clone(),
                            version: listed.version.clone(),
                            status,
                        });
                    }
                }
            },
        }
        state.reports.insert(report.url.clone(), report.clone());
        Ok(report)
    }

    /// Switches trust to the backup key on a revocation the backup signed.
    async fn revoke(&self, state: &mut State, index: &Index) -> Result<(), Problem> {
        let Some(revocation) = &index.revocation else {
            return Ok(());
        };
        let (Some(key), Some(signature)) = (unhex(&revocation.key), unhex(&revocation.signature))
        else {
            return Ok(());
        };
        if state.trust.revoked || !state.trust.revokes(&key, &signature) {
            return Ok(());
        }
        self.database
            .run(store::revoke)
            .await
            .map_err(|_| INTERNAL)?;
        state.trust.revoked = true;
        tracing::warn!("the active profile key is revoked; trusting only its backup");
        self.reload(state.trust).await.map_err(|_| INTERNAL)
    }

    /// Fetches, verifies and serves one entry when it would replace what is served.
    async fn offer(&self, trust: Trust, index: &str, listed: &Listed) -> Result<Status, Problem> {
        match listed.fit() {
            Fit::NewerCore => return Ok(Status::NewerCore),
            Fit::OldSchema => return Ok(Status::OldSchema),
            Fit::Loads => {}
        }
        let Some(version) = Version::parse(&listed.version) else {
            return Ok(Status::Invalid);
        };
        let current = self.catalogue.held(&listed.id);
        if current
            .as_ref()
            .is_some_and(|held| held.version() >= version)
        {
            return Ok(Status::Current);
        }
        let Ok(document) = self.get(&listed.resolve(index)).await else {
            return Ok(Status::Unreachable);
        };
        if unhex(&listed.sha256).as_deref() != Some(digest(&SHA256, &document).as_ref()) {
            return Ok(Status::Hash);
        }
        let fetched = Fetched {
            document,
            signature: listed.signature.as_deref().and_then(unhex),
        };
        let Some(held) = load(trust, &fetched)
            .filter(|held| held.profile.id == listed.id && held.version() == version)
        else {
            return Ok(Status::Invalid);
        };
        if !held.replaces(current.as_ref()) {
            return Ok(Status::Signature);
        }
        let id = listed.id.clone();
        self.database
            .run(move |db| store::keep(db, &id, &fetched))
            .await
            .map_err(|_| INTERNAL)?;
        self.catalogue.insert(held);
        Ok(Status::Loaded)
    }

    /// Serves the bundled snapshot and every stored copy under `trust`.
    async fn reload(&self, trust: Trust) -> Result<(), Error> {
        let mut profiles = bundled().map_err(Error::Bundled)?;
        let stored = self
            .database
            .run(store::fetched)
            .await
            .map_err(Error::Storage)?;
        for held in stored.iter().filter_map(|fetched| load(trust, fetched)) {
            if held.replaces(profiles.get(&held.profile.id)) {
                profiles.insert(held.profile.id.clone(), held);
            }
        }
        self.catalogue.replace(profiles);
        Ok(())
    }

    async fn get(&self, url: &str) -> Result<Vec<u8>, ()> {
        let fetch = Arc::clone(&self.fetch);
        let url = url.to_owned();
        let fetched = tokio::task::spawn_blocking(move || fetch.get(&url)).await;
        match fetched {
            Ok(Ok(bytes)) => Ok(bytes),
            Ok(Err(e)) => {
                tracing::warn!("profile fetch: {e}");
                Err(())
            }
            Err(_) => Err(()),
        }
    }
}

/// The profile in `fetched`, official when its signature verifies under `trust`.
fn load(trust: Trust, fetched: &Fetched) -> Option<Held> {
    let json = std::str::from_utf8(&fetched.document).ok()?;
    let profile = Profile::load(json).ok()?;
    let official = fetched
        .signature
        .as_deref()
        .is_some_and(|signature| trust.verifies(&fetched.document, signature));
    Some(Held {
        profile: Arc::new(profile),
        official,
    })
}

#[cfg(test)]
mod tests;
