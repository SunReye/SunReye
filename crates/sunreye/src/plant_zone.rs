//! The plant time zone: the IANA zone statistics cut days in and the forecast slices its days by
//! (ADR 0004). Stored by the core, validated against the bundled database, defaulting to the host's zone.

use jiff::tz::TimeZone;

use crate::store::{Store, StoreError};

/// The zone `name` names in the bundled database, or none. The database's own `Etc/Unknown`, which a
/// host with no zone reports, is no zone.
pub fn lookup(name: &str) -> Option<TimeZone> {
    jiff::tz::db().get(name).ok().filter(|zone| *zone != TimeZone::unknown())
}

/// The zone a plant starts with: the host's when it names a zone the database holds, else UTC.
fn default_name(host: Option<&str>) -> String {
    host.and_then(lookup).and_then(|zone| zone.iana_name().map(str::to_owned)).unwrap_or_else(|| "UTC".into())
}

/// The host's IANA name; none when it has no name the database holds.
fn host_name() -> Option<String> {
    TimeZone::system().iana_name().map(str::to_owned)
}

/// The zone plant days are cut in: the stored zone, the default while none is saved, UTC when the
/// stored name no longer resolves.
pub async fn plant_zone(store: &Store) -> Result<TimeZone, StoreError> {
    zone_with(store, host_name).await
}

async fn zone_with(store: &Store, host: impl FnOnce() -> Option<String>) -> Result<TimeZone, StoreError> {
    let name = match store.plant_time_zone().await? {
        Some(name) => name,
        None => default_name(host().as_deref()),
    };
    Ok(lookup(&name).unwrap_or_else(|| lost(&name)))
}

fn lost(name: &str) -> TimeZone {
    tracing::warn!(zone = name, "the plant time zone is not in the time zone database");
    TimeZone::UTC
}

/// A name the database does not hold.
#[derive(Debug, thiserror::Error)]
#[error("Unknown time zone: use an IANA name such as Europe/Berlin")]
pub struct UnknownZone;

#[derive(Debug, thiserror::Error)]
pub enum SaveError {
    #[error(transparent)]
    Unknown(#[from] UnknownZone),
    #[error(transparent)]
    Store(#[from] StoreError),
}

/// Saves `name` in its canonical spelling and returns it; a name the database lacks saves nothing.
pub async fn save(store: &Store, name: &str) -> Result<String, SaveError> {
    let canonical = lookup(name).and_then(|zone| zone.iana_name().map(str::to_owned)).ok_or(UnknownZone)?;
    store.save_plant_time_zone(&canonical).await?;
    Ok(canonical)
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn store() -> Store {
        Store::in_memory().await.expect("store")
    }

    async fn read(store: &Store, host: Option<&str>) -> TimeZone {
        zone_with(store, || host.map(str::to_owned)).await.expect("read")
    }

    fn name_of(zone: &TimeZone) -> Option<&str> {
        zone.iana_name()
    }

    #[test]
    fn a_name_in_the_database_resolves_and_anything_else_does_not() {
        for name in ["Europe/Berlin", "Asia/Kolkata", "Asia/Kathmandu", "UTC"] {
            assert_eq!(lookup(name).as_ref().and_then(name_of), Some(name), "{name}");
        }
        for name in ["", " ", "Mars/Olympus", " Europe/Berlin", "../etc/localtime", "Etc/Unknown"] {
            assert!(lookup(name).is_none(), "{name:?}");
        }
    }

    #[test]
    fn the_default_is_the_host_zone_when_the_database_holds_it_else_utc() {
        assert_eq!(default_name(Some("Asia/Kolkata")), "Asia/Kolkata");
        for host in [None, Some(""), Some("Etc/Unknown"), Some("Not/AZone")] {
            assert_eq!(default_name(host), "UTC", "{host:?}");
        }
    }

    #[tokio::test]
    async fn without_a_saved_zone_the_default_applies_and_a_saved_zone_beats_the_host() {
        let store = store().await;
        assert_eq!(name_of(&read(&store, Some("Asia/Kolkata")).await), Some("Asia/Kolkata"));
        assert_eq!(name_of(&read(&store, None).await), Some("UTC"));
        assert_eq!(name_of(&read(&store, Some("Mars/Olympus")).await), Some("UTC"));
        store.save_plant_time_zone("Europe/Berlin").await.expect("write");
        assert_eq!(name_of(&read(&store, Some("Asia/Kolkata")).await), Some("Europe/Berlin"));
        assert_eq!(store.plant_time_zone().await.expect("row").as_deref(), Some("Europe/Berlin"));
    }

    #[tokio::test]
    async fn a_saved_zone_is_kept_in_its_canonical_spelling_and_a_later_save_replaces_it() {
        let store = store().await;
        assert_eq!(save(&store, "europe/berlin").await.expect("save"), "Europe/Berlin");
        assert_eq!(store.plant_time_zone().await.expect("row").as_deref(), Some("Europe/Berlin"));
        let zone = plant_zone(&store).await.expect("read");
        assert_eq!(name_of(&zone), Some("Europe/Berlin"));
        assert_eq!(save(&store, "Asia/Kathmandu").await.expect("save"), "Asia/Kathmandu");
        let zone = plant_zone(&store).await.expect("read");
        assert_eq!(name_of(&zone), Some("Asia/Kathmandu"));
    }

    #[tokio::test]
    async fn a_refused_name_saves_nothing_and_the_saved_zone_stays() {
        let store = store().await;
        save(&store, "Asia/Kolkata").await.expect("save");
        for name in ["Mars/Olympus", "", "  ", &"x".repeat(65)] {
            assert!(matches!(save(&store, name).await, Err(SaveError::Unknown(_))), "{name:?}");
        }
        assert_eq!(store.plant_time_zone().await.expect("row").as_deref(), Some("Asia/Kolkata"));
    }

    #[tokio::test]
    async fn a_stored_name_the_database_lost_is_utc() {
        let store = store().await;
        store.save_plant_time_zone("Gone/Zone").await.expect("write");
        assert_eq!(name_of(&read(&store, Some("Asia/Kolkata")).await), Some("UTC"));
    }

    #[tokio::test]
    async fn the_host_is_asked_only_while_no_zone_is_saved() {
        let store = store().await;
        store.save_plant_time_zone("Asia/Kathmandu").await.expect("write");
        let zone = zone_with(&store, || panic!("the host was read")).await.expect("read");
        assert_eq!(name_of(&zone), Some("Asia/Kathmandu"));
    }
}
