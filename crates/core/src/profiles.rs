//! The profiles the core can read devices with (ADR 8): the official snapshot bundled at build
//! time, and profiles fetched from an index on an admin's action, verified and kept as the last
//! good copy.
//!
//! A newer copy of a profile already served waits as an update until the admin applies it; the
//! settings it adds or changes then need the admin's enable.
//!
//! The profiles module owns the `profile_index`, `fetched_profile`, `profile_update`,
//! `profile_setting_changed` and `profile_key_revoked` tables. It never fetches on its own: only
//! adding an index or checking for updates does.

mod diff;
#[cfg(test)]
pub(crate) mod fake;
mod fetch;
mod index;
mod routes;
mod store;
mod trust;

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, PoisonError, RwLock};
use std::time::SystemTime;

use ring::digest::{SHA256, digest};
use serde::Serialize;
use sunreye_profile::{LoadError, Profile};
use tokio::sync::Mutex;
use utoipa::ToSchema;

use crate::api::{Code, Problem, internal};
use crate::storage::{self, Database};
use index::{Fit, Index, Listed, Version};
use store::Fetched;
use trust::{Trust, unhex};

pub use diff::{Delta, QuantityChange, SettingChange, Update};
pub use fetch::{Fetch, Https};
pub use trust::{KEYS, Keys};

/// The official index, served by GitHub Pages from the `profiles-dist` branch.
pub const OFFICIAL_INDEX: &str = "https://sunreye.github.io/SunReye/index.json";

/// The official profiles, as `profiles/` holds them at build time.
const BUNDLED: &[&str] = &[
    include_str!("../../../profiles/deye-sg01hp3-10k.json"),
    include_str!("../../../profiles/deye-sg01hp3-12k.json"),
    include_str!("../../../profiles/deye-sg01hp3-15k.json"),
    include_str!("../../../profiles/deye-sg01hp3-20k.json"),
    include_str!("../../../profiles/deye-sg01hp3-25k.json"),
    include_str!("../../../profiles/deye-sg01hp3-5k.json"),
    include_str!("../../../profiles/deye-sg01hp3-6k.json"),
    include_str!("../../../profiles/deye-sg01hp3-8k.json"),
    include_str!("../../../profiles/deye-sg01hp3.json"),
    include_str!("../../../profiles/deye-sg05lp3.json"),
    include_str!("../../../profiles/deye-sun10k-sg05lp3.json"),
    include_str!("../../../profiles/deye-sun12k-sg05lp3.json"),
    include_str!("../../../profiles/deye-sun14k-sg05lp3.json"),
    include_str!("../../../profiles/deye-sun15k-sg05lp3.json"),
    include_str!("../../../profiles/deye-sun16k-sg05lp3.json"),
    include_str!("../../../profiles/deye-sun18k-sg05lp3.json"),
    include_str!("../../../profiles/deye-sun20k-sg05lp3.json"),
    include_str!("../../../profiles/deye-sun5k-sg05lp3.json"),
    include_str!("../../../profiles/deye-sun6k-sg05lp3.json"),
    include_str!("../../../profiles/deye-sun8k-sg05lp3.json"),
    include_str!("../../../profiles/evcc.json"),
    include_str!("../../../profiles/shelly-pro-3em.json"),
    include_str!("../../../profiles/sunspec.json"),
];

const NO_UPDATE: Problem = Problem {
    status: axum::http::StatusCode::NOT_FOUND,
    code: Code::UpdateNone,
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

/// Settings applied updates added or changed, as (profile, setting).
type Changed = HashSet<(String, String)>;

/// The profiles served, by id; clones share one catalogue, so a fetched profile reaches every
/// holder.
#[derive(Debug, Clone, Default)]
pub struct Catalogue {
    served: Arc<RwLock<Served>>,
    changed: Arc<RwLock<Changed>>,
}

impl Catalogue {
    /// Loads the bundled profiles.
    ///
    /// # Errors
    /// A bundled profile does not load in this build.
    pub fn bundled() -> Result<Self, LoadError> {
        Ok(Self {
            served: Arc::new(RwLock::new(bundled()?)),
            changed: Arc::default(),
        })
    }

    /// Whether an applied update added or changed `setting` of profile `id`: verified or not,
    /// it then needs the admin's enable (ADR 8).
    #[must_use]
    pub fn changed(&self, id: &str, setting: &str) -> bool {
        let changed = self.changed.read().unwrap_or_else(PoisonError::into_inner);
        changed.contains(&(id.to_owned(), setting.to_owned()))
    }

    fn mark(&self, id: &str, settings: Vec<String>) {
        let mut changed = self.changed.write().unwrap_or_else(PoisonError::into_inner);
        changed.extend(settings.into_iter().map(|s| (id.to_owned(), s)));
    }

    /// Every profile served, by id.
    #[must_use]
    pub fn profiles(&self) -> Vec<Arc<Profile>> {
        let profiles = self.served.read().unwrap_or_else(PoisonError::into_inner);
        let mut all: Vec<_> = profiles
            .values()
            .map(|held| Arc::clone(&held.profile))
            .collect();
        drop(profiles);
        all.sort_by(|a, b| a.id.cmp(&b.id));
        all
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
        let profiles = self.served.read().unwrap_or_else(PoisonError::into_inner);
        profiles.get(id).cloned()
    }

    fn replace(&self, profiles: Served) {
        *self.served.write().unwrap_or_else(PoisonError::into_inner) = profiles;
    }

    fn insert(&self, held: Held) {
        let mut profiles = self.served.write().unwrap_or_else(PoisonError::into_inner);
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
    /// A profile not served before: verified, loaded and now served.
    Loaded,
    /// A newer copy of a profile served: verified and waiting for the admin to apply it.
    Available,
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
        let changed = profiles
            .database
            .run(store::changed)
            .await
            .map_err(Error::Storage)?;
        for (id, setting) in changed {
            profiles.catalogue.mark(&id, vec![setting]);
        }
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
        let urls = self.urls().await.map_err(internal)?;
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
                .map_err(internal)?;
        }
        let mut state = self.state.lock().await;
        self.check_index(&mut state, url).await
    }

    /// Checks every index for updates, the official one first.
    ///
    /// # Errors
    /// The file cannot be read or written.
    pub async fn check(&self) -> Result<Vec<Report>, Problem> {
        let urls = self.urls().await.map_err(internal)?;
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
        self.database.run(store::revoke).await.map_err(internal)?;
        state.trust.revoked = true;
        tracing::warn!("the active profile key is revoked; trusting only its backup");
        self.reload(state.trust).await.map_err(internal)
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
        let waiting = self.waiting(trust, &listed.id).await?;
        if [current.as_ref(), waiting.as_ref()]
            .into_iter()
            .flatten()
            .any(|held| held.version() >= version)
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
        self.receive(held, fetched, current.is_some()).await
    }

    /// Keeps a verified copy: as the update to the profile `served`, else served at once.
    async fn receive(&self, held: Held, fetched: Fetched, served: bool) -> Result<Status, Problem> {
        let id = held.profile.id.clone();
        if served {
            self.database
                .run(move |db| store::wait(db, &id, &fetched))
                .await
                .map_err(internal)?;
            return Ok(Status::Available);
        }
        self.database
            .run(move |db| store::keep(db, &id, &fetched))
            .await
            .map_err(internal)?;
        self.catalogue.insert(held);
        Ok(Status::Loaded)
    }

    /// The update waiting for profile `id` that would replace the one served, under `trust`.
    async fn waiting(&self, trust: Trust, id: &str) -> Result<Option<Held>, Problem> {
        let key = id.to_owned();
        let waiting = self
            .database
            .run(move |db| store::waiting(db, &key))
            .await
            .map_err(internal)?;
        let current = self.catalogue.held(id);
        Ok(waiting
            .and_then(|fetched| load(trust, &fetched))
            .filter(|held| held.profile.id == id && held.replaces(current.as_ref())))
    }

    /// Every update waiting for a profile served, with what it changes.
    ///
    /// # Errors
    /// The file cannot be read.
    pub async fn updates(&self) -> Result<Vec<Update>, Problem> {
        let trust = self.state.lock().await.trust;
        let waiting = self.database.run(store::updates).await.map_err(internal)?;
        Ok(waiting
            .iter()
            .filter_map(|(id, fetched)| {
                let current = self.catalogue.held(id)?;
                let held = load(trust, fetched)
                    .filter(|held| held.profile.id == *id && held.replaces(Some(&current)))?;
                Some(Update::between(&current.profile, &held.profile))
            })
            .collect())
    }

    /// Serves the update waiting for profile `id`. Each setting it adds or changes is off until
    /// the admin enables it (ADR 8).
    ///
    /// # Errors
    /// No update waits for `id`, or the file cannot be written.
    pub async fn apply(&self, id: &str, time: SystemTime) -> Result<Update, Problem> {
        let state = self.state.lock().await;
        let held = self.waiting(state.trust, id).await?.ok_or(NO_UPDATE)?;
        let current = self.catalogue.held(id).ok_or(NO_UPDATE)?;
        let update = Update::between(&current.profile, &held.profile);
        let changed = update.touched();
        let key = id.to_owned();
        let fetched = self
            .database
            .run(move |db| store::waiting(db, &key))
            .await
            .map_err(internal)?
            .ok_or(NO_UPDATE)?;
        let applied = changed.clone();
        let version = update.to.clone();
        let key = id.to_owned();
        self.database
            .run(move |db| {
                let applied = store::Applied {
                    id: &key,
                    version: &version,
                    fetched: &fetched,
                    changed: &applied,
                    time,
                };
                store::apply(db, &applied)
            })
            .await
            .map_err(internal)?;
        self.catalogue.mark(id, changed);
        self.catalogue.insert(held);
        drop(state);
        Ok(update)
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
