//! Profile sources: a base URL plus the path of an `index.json`, fetched over HTTPS (ADR 0002). Each file
//! the index lists is validated against the profile schema before use; an invalid one is skipped and
//! reported, the rest still load. Sources and their profiles are kept in one core setting.

use std::collections::BTreeSet;
use std::sync::Arc;
use std::time::{Duration, Instant};

use reqwest::Url;
use rustls::pki_types::CertificateDer;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use serde_json::error::Category;
use utoipa::ToSchema;

use crate::https::{GetError, Limits, get_with_roots};
use crate::profile::{Bundle, Profile};
use crate::store::{Store, StoreError};

pub const SOURCES_KEY: &str = "profile.sources";

/// Where a source's profile files live. No credentials: a URL with userinfo, a query or a fragment is
/// refused, so nothing secret is stored or logged.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    /// `https://` base the index and every profile path resolve against.
    pub base_url: String,
    /// Path of the index under the base, e.g. `index.json`.
    pub index_path: String,
}

#[derive(Debug, thiserror::Error)]
pub enum SourceError {
    #[error("{0}")]
    Url(String),
    #[error("cannot fetch the index: {0}")]
    Index(GetError),
    #[error("the index is not valid: {0}")]
    MalformedIndex(String),
}

impl Source {
    /// The source with its base in canonical form: ends in `/`, no credentials, no query.
    pub fn normalised(&self) -> Result<Self, SourceError> {
        let root = self.root()?;
        resolve(&root, &self.index_path)
            .ok_or_else(|| SourceError::Url("The index path must stay under the base URL".into()))?;
        Ok(Self { base_url: root.into(), index_path: self.index_path.trim().to_owned() })
    }

    fn root(&self) -> Result<Url, SourceError> {
        let mut url = Url::parse(self.base_url.trim())
            .map_err(|e| SourceError::Url(format!("The base URL is not a URL: {e}")))?;
        if url.scheme() != "https" {
            return Err(SourceError::Url("The base URL must start with https://".into()));
        }
        if url.host().is_none() || has_extras(&url) {
            return Err(SourceError::Url(
                "The base URL needs a host and no credentials, query or fragment".into(),
            ));
        }
        if !url.path().ends_with('/') {
            let path = format!("{}/", url.path());
            url.set_path(&path);
        }
        Ok(url)
    }
}

fn has_extras(url: &Url) -> bool {
    !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
}

/// `path` under `root`, or none when it leaves the source's host or directory.
fn resolve(root: &Url, path: &str) -> Option<Url> {
    let url = root.join(path.trim()).ok()?;
    (url.origin() == root.origin() && url.path().starts_with(root.path()) && !has_extras(&url)).then_some(url)
}

/// A profile that passed the schema, with the JSON it came from.
#[derive(Debug, Clone)]
pub struct Installed {
    pub profile: Arc<Profile>,
    pub json: Value,
}

impl Installed {
    /// Validates `json` against the profile schema.
    pub fn validate(json: Value) -> Result<Self, String> {
        let profile: Profile = serde_json::from_value(json.clone()).map_err(|e| describe(&e))?;
        Ok(Self { profile: Arc::new(profile), json })
    }
}

/// serde's message without the values it quotes: the source is untrusted and its text must not come back
/// in an error or a log.
fn describe(error: &serde_json::Error) -> String {
    let text = error.to_string();
    if error.classify() != Category::Data || text.starts_with("missing field `") {
        return text;
    }
    match text.rsplit_once(", expected ") {
        Some((found, expected)) => {
            let kind = found.split([':', '`']).next().unwrap_or_default().trim();
            format!("{kind}, expected {expected}")
        }
        None => "does not match the profile schema".into(),
    }
}

/// A file the index listed that did not load.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct Skipped {
    pub path: String,
    pub reason: String,
}

#[derive(Debug, Default)]
pub struct Fetched {
    pub profiles: Vec<Installed>,
    pub skipped: Vec<Skipped>,
}

#[derive(Deserialize)]
struct Index {
    profiles: Vec<Entry>,
}

#[derive(Deserialize)]
struct Entry {
    id: String,
    path: String,
}

/// Bounds on each request to a source: a profile file is tens of kilobytes.
pub const REQUEST_LIMITS: Limits = Limits { timeout: Duration::from_secs(15), max_bytes: 256 * 1024 };

/// What one fetch spends on profile files before it skips the rest of the index. The sizes are a few
/// times the official set (632 KB, 20 files) so a parsed source stays well inside ADR 0006's resident
/// budget.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Budget {
    /// Bytes of every body read, a rejected one included.
    pub bytes: usize,
    /// Files the index may list.
    pub entries: usize,
    /// All the profile files together.
    pub time: Duration,
}

pub const BUDGET: Budget = Budget { bytes: 2 << 20, entries: 128, time: Duration::from_secs(60) };

/// Fetches the index and every profile it lists. `limits` bounds each request and `budget` all of them;
/// `roots` are trusted besides the built-in store; a profile whose id `is_reserved` is skipped.
pub async fn fetch(
    source: &Source,
    limits: Limits,
    budget: Budget,
    roots: &[CertificateDer<'_>],
    is_reserved: impl Fn(&str) -> bool,
) -> Result<Fetched, SourceError> {
    let root = source.root()?;
    let index_url = resolve(&root, &source.index_path)
        .ok_or_else(|| SourceError::Url("The index path must stay under the base URL".into()))?;
    let body = get_with_roots(index_url.as_str(), limits, roots).await.map_err(SourceError::Index)?;
    let index: Index =
        serde_json::from_slice(&body).map_err(|e| SourceError::MalformedIndex(describe(&e)))?;
    let mut fetched = Fetched::default();
    let (mut seen, mut spent, started) = (BTreeSet::new(), 0, Instant::now());
    for (position, entry) in index.profiles.into_iter().enumerate() {
        let left = budget.time.saturating_sub(started.elapsed());
        let loaded = if let Some(reason) = over_budget(budget, position, spent, left) {
            Err(reason)
        } else if is_reserved(&entry.id) {
            Err("the id belongs to a compiled-in profile".into())
        } else if seen.contains(&entry.id) {
            Err("the index lists this id twice".into())
        } else {
            let bounded = Limits { timeout: limits.timeout.min(left), ..limits };
            let loaded = load(&root, &entry, bounded, roots).await;
            spent += loaded.spent;
            loaded.outcome
        };
        match loaded {
            Ok(profile) => {
                seen.insert(entry.id);
                fetched.profiles.push(profile);
            }
            Err(reason) => fetched.skipped.push(Skipped { path: entry.path, reason }),
        }
    }
    Ok(fetched)
}

/// Why the entry at `position` is not fetched, when `spent` bytes and the time `left` say so.
fn over_budget(budget: Budget, position: usize, spent: usize, left: Duration) -> Option<String> {
    if position >= budget.entries {
        Some(format!("the index lists more than {} files", budget.entries))
    } else if spent >= budget.bytes {
        Some(format!("the source holds more than {} bytes", budget.bytes))
    } else if left.is_zero() {
        Some(format!("the source took longer than {:?}", budget.time))
    } else {
        None
    }
}

/// One listed file, validated, and the body bytes it cost whether or not it passed.
struct Loaded {
    outcome: Result<Installed, String>,
    spent: usize,
}

async fn load(root: &Url, entry: &Entry, limits: Limits, roots: &[CertificateDer<'_>]) -> Loaded {
    let Some(url) = resolve(root, &entry.path) else {
        return Loaded { outcome: Err("the path leaves the source".into()), spent: 0 };
    };
    match get_with_roots(url.as_str(), limits, roots).await {
        Ok(body) => Loaded { spent: body.len(), outcome: validated(&body, entry) },
        Err(error) => {
            let spent = if matches!(error, GetError::TooLarge { .. }) { limits.max_bytes } else { 0 };
            Loaded { outcome: Err(error.to_string()), spent }
        }
    }
}

fn validated(body: &[u8], entry: &Entry) -> Result<Installed, String> {
    let json = serde_json::from_slice(body).map_err(|e| format!("not JSON: {}", describe(&e)))?;
    let installed = Installed::validate(json)?;
    if installed.profile.id != entry.id {
        return Err("the file holds another id than the index lists".into());
    }
    Ok(installed)
}

/// A source with the profiles it supplied, as stored.
#[derive(Debug, Serialize, Deserialize)]
struct Saved {
    #[serde(flatten)]
    source: Source,
    profiles: Vec<Value>,
}

async fn read_saved(store: &Store) -> Result<Vec<Saved>, StoreError> {
    match store.setting(SOURCES_KEY).await? {
        Some(text) => serde_json::from_str(&text).map_err(|_| StoreError::Corrupt("profile sources")),
        None => Ok(Vec::new()),
    }
}

/// Held across `save_source`'s read and write, so two saves never lose one another.
static SAVING: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// Stores `profiles` as what `source` supplies, replacing an earlier fetch of the same source.
pub async fn save_source(store: &Store, source: &Source, profiles: &[Installed]) -> Result<(), StoreError> {
    let _one_writer = SAVING.lock().await;
    let mut saved = read_saved(store).await?;
    saved.retain(|s| s.source != *source);
    saved.push(Saved { source: source.clone(), profiles: profiles.iter().map(|p| p.json.clone()).collect() });
    let text = serde_json::to_string(&saved).map_err(|_| StoreError::Corrupt("profile sources"))?;
    store.set_setting(SOURCES_KEY, &text).await
}

/// A stored source with the ids of the profiles it supplied.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Listed {
    #[serde(flatten)]
    pub source: Source,
    pub profile_ids: Vec<String>,
}

pub async fn list_sources(store: &Store) -> Result<Vec<Listed>, StoreError> {
    let saved = read_saved(store).await?;
    Ok(saved
        .into_iter()
        .map(|s| {
            let profile_ids = valid(&s.profiles).into_iter().map(|p| p.profile.id.clone()).collect();
            Listed { source: s.source, profile_ids }
        })
        .collect())
}

/// Every stored profile that still passes the schema, earlier sources first; an id supplied twice keeps its
/// first.
pub async fn installed(store: &Store) -> Result<Vec<Installed>, StoreError> {
    let mut seen = BTreeSet::new();
    let all = read_saved(store).await?.into_iter().flat_map(|s| valid(&s.profiles));
    Ok(all.filter(|p| seen.insert(p.profile.id.clone())).collect())
}

fn valid(stored: &[Value]) -> Vec<Installed> {
    stored
        .iter()
        .filter_map(|json| match Installed::validate(json.clone()) {
            Ok(installed) => Some(installed),
            Err(reason) => {
                tracing::warn!(%reason, "a stored profile no longer passes the schema, skipped");
                None
            }
        })
        .collect()
}

/// The compiled-in profile `id`, else the installed one: a compiled-in id is never shadowed.
pub fn find_profile(bundle: &Bundle, installed: &[Installed], id: &str) -> Option<Arc<Profile>> {
    bundle.profile(id).or_else(|| installed.iter().map(|p| &p.profile).find(|p| p.id == id)).map(Arc::clone)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn profile(id: &str) -> Installed {
        let json = json!({"id": id, "name": id, "manufacturer": "Acme", "version": "1.0.0", "metrics": []});
        Installed::validate(json).expect("valid")
    }

    fn source(base: &str) -> Source {
        Source { base_url: base.into(), index_path: "index.json".into() }
    }

    fn ids(profiles: &[Installed]) -> Vec<&str> {
        profiles.iter().map(|p| p.profile.id.as_str()).collect()
    }

    #[test]
    fn a_profile_needs_every_field_of_the_schema() {
        let valid = json!({"id": "a", "name": "A", "manufacturer": "M", "version": "1", "metrics": []});
        assert!(Installed::validate(valid.clone()).is_ok());
        for field in ["id", "name", "manufacturer", "version", "metrics"] {
            let mut broken = valid.clone();
            broken.as_object_mut().expect("object").remove(field);
            let reason = Installed::validate(broken).expect_err(field);
            assert!(reason.contains(field), "{field}: {reason}");
        }
        assert!(Installed::validate(json!([])).is_err());
        assert!(Installed::validate(json!({"metrics": [{"key": "k"}]})).is_err());
    }

    #[tokio::test]
    async fn nothing_is_stored_until_a_source_is_saved() {
        let store = Store::in_memory().await.expect("store");
        assert_eq!(list_sources(&store).await.expect("list"), []);
        assert_eq!(ids(&installed(&store).await.expect("installed")), [] as [&str; 0]);
    }

    #[tokio::test]
    async fn a_saved_source_reads_back_with_its_profiles_and_saving_again_replaces_it() {
        let store = Store::in_memory().await.expect("store");
        let (a, b) = (source("https://a.example/"), source("https://b.example/"));
        save_source(&store, &a, &[profile("one"), profile("two")]).await.expect("save");
        save_source(&store, &b, &[profile("three")]).await.expect("save");
        save_source(&store, &a, &[profile("one")]).await.expect("save again");
        let listed = list_sources(&store).await.expect("list");
        let seen: Vec<_> =
            listed.iter().map(|l| (l.source.base_url.as_str(), l.profile_ids.clone())).collect();
        assert_eq!(
            seen,
            [
                ("https://b.example/", vec!["three".to_owned()]),
                ("https://a.example/", vec!["one".to_owned()])
            ]
        );
        assert_eq!(ids(&installed(&store).await.expect("installed")), ["three", "one"]);
    }

    #[tokio::test]
    async fn an_id_supplied_by_two_sources_keeps_the_earlier_one() {
        let store = Store::in_memory().await.expect("store");
        let mut later = profile("shared");
        later.json["name"] = json!("later");
        save_source(&store, &source("https://a.example/"), &[profile("shared")]).await.expect("save");
        save_source(
            &store,
            &source("https://b.example/"),
            &[Installed::validate(later.json).expect("valid")],
        )
        .await
        .expect("save");
        let all = installed(&store).await.expect("installed");
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].profile.name, "shared");
    }

    #[tokio::test]
    async fn a_stored_profile_that_no_longer_passes_the_schema_is_skipped_not_fatal() {
        let store = Store::in_memory().await.expect("store");
        let text = json!([{
            "baseUrl": "https://a.example/", "indexPath": "index.json",
            "profiles": [{"id": "stale"}, profile("kept").json]
        }]);
        store.set_setting(SOURCES_KEY, &text.to_string()).await.expect("set");
        assert_eq!(ids(&installed(&store).await.expect("installed")), ["kept"]);
        assert_eq!(list_sources(&store).await.expect("list")[0].profile_ids, ["kept"]);
    }

    #[tokio::test]
    async fn a_damaged_setting_is_an_error_and_saving_does_not_overwrite_it() {
        let store = Store::in_memory().await.expect("store");
        store.set_setting(SOURCES_KEY, "not json").await.expect("set");
        assert!(matches!(list_sources(&store).await, Err(StoreError::Corrupt(_))));
        assert!(matches!(installed(&store).await, Err(StoreError::Corrupt(_))));
        let saved = save_source(&store, &source("https://a.example/"), &[profile("x")]).await;
        assert!(matches!(saved, Err(StoreError::Corrupt(_))));
        assert_eq!(store.setting(SOURCES_KEY).await.expect("read").as_deref(), Some("not json"));
    }

    #[test]
    fn a_compiled_in_id_is_never_shadowed_by_an_installed_profile() {
        let bundle = Bundle::official().expect("bundle");
        let builtin = bundle.profiles[0].profile.id.clone();
        let mut clash = profile(&builtin).json;
        clash["name"] = json!("impostor");
        let all = [Installed::validate(clash).expect("valid"), profile("acme")];
        assert_eq!(all[0].profile.name, "impostor");
        let found = find_profile(&bundle, &all, &builtin).expect("found");
        assert_eq!(found.name, bundle.profiles[0].profile.name);
        assert_eq!(find_profile(&bundle, &all, "acme").expect("found").id, "acme");
        assert!(find_profile(&bundle, &all, "nobody").is_none());
    }

    async fn save_numbered(store: Arc<Store>, n: usize) -> Result<(), StoreError> {
        save_source(&store, &source(&format!("https://s{n}.example/")), &[profile("p")]).await
    }

    #[tokio::test]
    async fn concurrent_saves_of_different_sources_all_survive() {
        let store = Arc::new(Store::in_memory().await.expect("store"));
        let mut saves = tokio::task::JoinSet::new();
        for n in 0..8 {
            saves.spawn(save_numbered(Arc::clone(&store), n));
        }
        while let Some(saved) = saves.join_next().await {
            saved.expect("task").expect("save");
        }
        assert_eq!(list_sources(&store).await.expect("list").len(), 8);
    }
}
