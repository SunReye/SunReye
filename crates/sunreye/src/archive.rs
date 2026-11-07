//! Archive import (ADR 0003): a 3.x archive's plant, devices and readings into an empty store, in one
//! transaction. Every member is read and checked before anything is written. Monitoring only (ADR 0005):
//! nothing here writes a register.

mod config;
mod container;
mod land;
mod plan;
#[cfg(test)]
pub(crate) mod testing;

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use jiff::Timestamp;
use serde::Deserialize;

use self::config::Config;
pub use self::config::{Held, Saved};
use self::container::{CONTAINER, Container, Member};
use crate::profile::Bundle;
use crate::retention::{RAW_KEY, key, raw_days, retention_days};
use crate::rollup::Tier;
use crate::sources::{find_profile, installed};
use crate::store::{Store, StoreError};

const MANIFEST: &str = "manifest.json";
const READINGS: &str = "readings.ndjson.gz";
const CONFIG_LOG: &str = "config-log.ndjson.gz";
const FORMAT: &str = "sunreye-archive";
const FORMAT_VERSION: u32 = 1;

#[derive(Debug, thiserror::Error)]
pub enum ImportError {
    /// A member is missing, truncated or does not read; nothing was written.
    #[error("{member}: {reason}")]
    Member { member: String, reason: String },
    #[error("profile {0} is neither compiled in nor supplied by a profile source")]
    UnknownProfile(String),
    /// The store already holds devices: a second import, or one over a configured core.
    #[error("the store already holds devices: import into a new store")]
    NotEmpty,
    #[error(transparent)]
    Store(#[from] StoreError),
}

/// Rows per stream, as `manifest.json` counts them.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize, serde::Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Streams {
    pub raw: u64,
    pub minute: u64,
    pub hourly: u64,
    pub daily: u64,
    pub config_log: u64,
}

/// A span of a device's history no bucket tier answers whole; its bucket rows were not imported.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Gap {
    pub device: String,
    pub start: Timestamp,
    pub end: Timestamp,
}

/// Two archive lines at one device, metric, instant and tier with different values; the first is kept.
#[derive(Debug, Clone, PartialEq)]
pub struct Conflict {
    pub device: String,
    pub metric: String,
    pub at: Timestamp,
    pub kept: f64,
    pub dropped: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Imported {
    /// Rows read; the configuration log is read and checked, but 4.0 keeps no register history.
    pub read: Streams,
    pub gaps: Vec<Gap>,
    /// Lines dropped for a [`Conflict`].
    pub conflicts: u64,
    pub first_conflict: Option<Conflict>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    format: String,
    format_version: u32,
    plant_time_zone: Option<String>,
    streams: Streams,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
enum SourceTier {
    Raw,
    Minute,
    Hourly,
    Daily,
}

/// One `readings.ndjson` or `config-log.ndjson` line.
#[derive(Debug)]
struct Reading {
    at_ms: i64,
    device_slug: String,
    metric_key: String,
    value: f64,
    source_tier: SourceTier,
}

impl Reading {
    fn parse(line: &str) -> Result<Self, String> {
        #[derive(Deserialize)]
        struct Line {
            time: String,
            device_slug: String,
            metric_key: String,
            value: f64,
            source_tier: Option<SourceTier>,
        }
        let line: Line = serde_json::from_str(line).map_err(|e| e.to_string())?;
        let at: Timestamp = line.time.parse().map_err(|_| format!("time {} is not an instant", line.time))?;
        Ok(Self {
            at_ms: at.as_millisecond(),
            device_slug: line.device_slug,
            metric_key: line.metric_key,
            value: line.value,
            source_tier: line.source_tier.unwrap_or(SourceTier::Raw),
        })
    }
}

/// What reading every member found: the one parse of `config.json` the guard and the import both read.
#[derive(Debug)]
pub struct Checked {
    config: Config,
    zone: Option<String>,
    read: Streams,
}

fn missing(member: &str) -> ImportError {
    ImportError::Member { member: member.to_owned(), reason: "missing".into() }
}

fn bad(member: &str, reason: impl std::fmt::Display) -> ImportError {
    ImportError::Member { member: member.to_owned(), reason: reason.to_string() }
}

/// What the members read so far hold.
#[derive(Default)]
struct Found {
    manifest: Option<Manifest>,
    config: Option<Config>,
    read: Streams,
    streams: BTreeSet<&'static str>,
    slugs: BTreeSet<String>,
}

impl Found {
    fn read_member(&mut self, member: Member<'_>) -> Result<(), ImportError> {
        match member.name.as_str() {
            MANIFEST => self.manifest = Some(manifest(&member.text()?)?),
            config::MEMBER => {
                self.config = Some(Config::parse(&member.text()?).map_err(|e| bad(config::MEMBER, e))?);
            }
            READINGS => self.count(member, READINGS)?,
            CONFIG_LOG => self.count(member, CONFIG_LOG)?,
            _ => {}
        }
        Ok(())
    }

    fn count(&mut self, member: Member<'_>, stream: &'static str) -> Result<(), ImportError> {
        let mut lines = member.lines();
        while let Some((_, line)) = lines.next_line()? {
            let reading = Reading::parse(line).map_err(|reason| lines.at(reason))?;
            let count = match (stream, reading.source_tier) {
                (CONFIG_LOG, _) => &mut self.read.config_log,
                (_, SourceTier::Raw) => &mut self.read.raw,
                (_, SourceTier::Minute) => &mut self.read.minute,
                (_, SourceTier::Hourly) => &mut self.read.hourly,
                (_, SourceTier::Daily) => &mut self.read.daily,
            };
            *count += 1;
            self.slugs.insert(reading.device_slug);
        }
        self.streams.insert(stream);
        Ok(())
    }

    fn finish(self) -> Result<Checked, ImportError> {
        let manifest = self.manifest.ok_or_else(|| missing(MANIFEST))?;
        let config = self.config.ok_or_else(|| missing(config::MEMBER))?;
        if let Some(stream) = [READINGS, CONFIG_LOG].into_iter().find(|s| !self.streams.contains(s)) {
            return Err(missing(stream));
        }
        if self.read != manifest.streams {
            return Err(bad(
                READINGS,
                format!("holds {:?}; {MANIFEST} counts {:?}", self.read, manifest.streams),
            ));
        }
        if let Some(slug) = self.slugs.iter().find(|s| !config.plant.devices.iter().any(|d| &&d.slug == s)) {
            return Err(bad(READINGS, format!("device {slug} is not in {}", config::MEMBER)));
        }
        let zone = config.plant.time_zone.clone().or(manifest.plant_time_zone);
        if let Some(zone) = zone.as_deref()
            && crate::plant_zone::lookup(zone).is_none()
        {
            return Err(bad(MANIFEST, format!("time zone {zone} is not an IANA name")));
        }
        Ok(Checked { config, zone, read: self.read })
    }
}

fn manifest(text: &str) -> Result<Manifest, ImportError> {
    let parsed: Manifest = serde_json::from_str(text).map_err(|e| bad(MANIFEST, e))?;
    if parsed.format != FORMAT {
        return Err(bad(MANIFEST, format!("format {} is not {FORMAT}", parsed.format)));
    }
    if parsed.format_version > FORMAT_VERSION {
        let reason = format!("format version {} is newer than this core reads", parsed.format_version);
        return Err(bad(MANIFEST, reason));
    }
    Ok(parsed)
}

impl Checked {
    /// The automation guard: the saved user values when the archive's 3.x automation is on or still holds a
    /// register, `None` when the archive imports without asking.
    pub fn guard(&self) -> Result<Option<Vec<Held>>, ImportError> {
        self.config.guard().map_err(|e| bad(config::MEMBER, e))
    }
}

/// Reads every member front to back and refuses the first that is missing, truncated, unreadable or repeated.
pub fn check(path: &Path) -> Result<Checked, ImportError> {
    let mut archive = Container::open(path)?;
    let mut found = Found::default();
    while let Some(member) = archive.next_member()? {
        found.read_member(member)?;
    }
    found.finish()
}

/// Imports the archive at `path` into `store`, which must hold no device. Raw readings and minute buckets
/// are kept back to the store's retention from `now`; hours and days are kept to theirs.
pub async fn import(
    store: &Store,
    bundle: &Bundle,
    path: &Path,
    now: Timestamp,
) -> Result<Imported, ImportError> {
    let owned: PathBuf = path.to_owned();
    let checked =
        tokio::task::spawn_blocking(move || check(&owned)).await.map_err(|e| bad(CONTAINER, e))??;
    import_checked(store, bundle, path, checked, now).await
}

/// [`import`] of the archive at `path` that [`check`] read as `checked`.
pub async fn import_checked(
    store: &Store,
    bundle: &Bundle,
    path: &Path,
    checked: Checked,
    now: Timestamp,
) -> Result<Imported, ImportError> {
    if !store.devices().await?.is_empty() {
        return Err(ImportError::NotEmpty);
    }
    let profiles = installed(store).await?;
    for device in &checked.config.plant.devices {
        if find_profile(bundle, &profiles, &device.profile_id).is_none() {
            return Err(ImportError::UnknownProfile(device.profile_id.clone()));
        }
    }
    let kept =
        async |tier| Ok::<_, StoreError>(retention_days(tier, store.setting(key(tier)).await?.as_deref()));
    let cut = land::cutoffs(
        now,
        raw_days(store.setting(RAW_KEY).await?.as_deref()),
        kept(Tier::Minute).await?,
        kept(Tier::Hour).await?,
        kept(Tier::Day).await?,
    );
    let landed = land::land(store, &checked, &mut Container::open(path)?, cut).await?;
    Ok(Imported {
        read: checked.read,
        gaps: landed.gaps,
        conflicts: landed.conflicts,
        first_conflict: landed.first_conflict,
    })
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use sqlx::Row;

    use super::testing::{file, gz, tar};
    use super::*;

    const DEVICE: &str = "inv";

    fn config() -> String {
        json!({"plant": {"timeZone": "Europe/Berlin", "connections": [
                  {"name": "Gateway", "kind": "modbus", "params": {"host": "10.0.0.2", "port": 502}}],
              "devices": [{"slug": DEVICE, "profileId": "deye-sg05lp3", "role": "inverter", "unitId": 1,
                           "connection": "Gateway"}]}})
        .to_string()
    }

    fn line(tier: &str, time: &str, metric: &str, value: f64) -> String {
        json!({"time": time, "device_slug": DEVICE, "metric_key": metric, "value": value, "source_tier": tier})
            .to_string()
            + "\n"
    }

    /// An archive of `readings` (NDJSON text), its manifest counting `streams`.
    fn archive(readings: &str, streams: &serde_json::Value) -> PathBuf {
        archive_of(config(), readings, streams)
    }

    fn archive_of(config: String, readings: &str, streams: &serde_json::Value) -> PathBuf {
        let manifest = json!({"format": FORMAT, "formatVersion": 1, "plantTimeZone": "Europe/Berlin", "streams": streams});
        file(&gz(&tar(&[
            (MANIFEST, manifest.to_string().into_bytes()),
            (config::MEMBER, config.into_bytes()),
            (CONFIG_LOG, gz(b"")),
            (READINGS, gz(readings.as_bytes())),
        ])))
    }

    fn streams(raw: u64, minute: u64, hourly: u64, daily: u64) -> serde_json::Value {
        json!({"raw": raw, "minute": minute, "hourly": hourly, "daily": daily, "configLog": 0})
    }

    fn at(instant: &str) -> Timestamp {
        instant.parse().expect("instant")
    }

    async fn run(path: &Path, now: &str) -> (Store, Result<Imported, ImportError>) {
        let store = Store::in_memory().await.expect("store");
        let imported = import(&store, &Bundle::official().expect("bundle"), path, at(now)).await;
        (store, imported)
    }

    async fn refusal(path: &Path) -> String {
        let (store, imported) = run(path, "2026-05-02T00:00:00Z").await;
        assert_eq!(store.devices().await.expect("devices"), [], "nothing written");
        imported.expect_err("refused").to_string()
    }

    async fn device(store: &Store) -> i64 {
        store.devices().await.expect("devices")[0].id
    }

    /// A plant of the given devices (slug, profile, retired) on one connection.
    fn plant_of(devices: &[(&str, &str, Option<&str>)]) -> String {
        let devices: Vec<_> = devices
            .iter()
            .map(|(slug, profile, retired)| {
                json!({"slug": slug, "profileId": profile, "role": "inverter", "unitId": 1,
                       "connection": "Gateway", "retiredAt": retired})
            })
            .collect();
        json!({"plant": {"timeZone": "Europe/Berlin", "connections": [
                  {"name": "Gateway", "kind": "modbus", "params": {"host": "10.0.0.2", "port": 502}}],
              "devices": devices}})
        .to_string()
    }

    async fn active_profile(store: &Store) -> Option<String> {
        store.setting(crate::settings::PROFILE_KEY).await.expect("setting")
    }

    #[tokio::test]
    async fn the_active_profile_is_the_first_non_retired_devices() {
        const RETIRED: Option<&str> = Some("2026-04-01T00:00:00Z");
        for (devices, want) in [
            (vec![("a", "deye-sg05lp3", None), ("b", "deye-sg01hp3", None)], Some("deye-sg05lp3")),
            (vec![("a", "deye-sg05lp3", RETIRED), ("b", "deye-sg01hp3", None)], Some("deye-sg01hp3")),
            (
                vec![
                    ("a", "deye-sg05lp3", RETIRED),
                    ("b", "deye-sg01hp3", RETIRED),
                    ("c", "deye-sg01hp3-5k", None),
                ],
                Some("deye-sg01hp3-5k"),
            ),
            (vec![("a", "deye-sg05lp3", RETIRED)], None),
        ] {
            let path = archive_of(plant_of(&devices), "", &streams(0, 0, 0, 0));
            let (store, imported) = run(&path, "2026-05-02T00:00:00Z").await;
            imported.expect("import");
            assert_eq!(active_profile(&store).await.as_deref(), want, "{devices:?}");
        }
    }

    #[tokio::test]
    async fn a_write_that_fails_after_the_data_landed_leaves_neither_data_nor_profile_and_a_retry_imports() {
        let path = archive(&line("raw", "2026-05-01T12:00:00Z", "p", 1.0), &streams(1, 0, 0, 0));
        let store = Store::in_memory().await.expect("store");
        let bundle = Bundle::official().expect("bundle");
        let now = at("2026-05-02T00:00:00Z");
        let mut conn = store.hold().await;
        sqlx::query(
            "CREATE TEMP TRIGGER no_profile BEFORE INSERT ON setting WHEN NEW.key = 'profile.active' \
             BEGIN SELECT RAISE(ABORT, 'disk full'); END",
        )
        .execute(&mut *conn)
        .await
        .expect("trigger");
        drop(conn);
        let mut hints = store.bus().changes.subscribe();
        let failed = import(&store, &bundle, &path, now).await.expect_err("the write fails");
        assert_eq!(crate::store::tests::published(&mut hints), [], "nothing committed");
        assert!(failed.to_string().contains("disk full"), "{failed}");
        assert_eq!(store.devices().await.expect("devices"), [], "no data");
        assert_eq!(active_profile(&store).await, None, "no profile");
        assert_eq!(store.plant_time_zone().await.expect("zone"), None, "no plant");
        let mut conn = store.hold().await;
        sqlx::query("DROP TRIGGER no_profile").execute(&mut *conn).await.expect("drop");
        drop(conn);
        import(&store, &bundle, &path, now).await.expect("a retry of the same archive imports");
        assert_eq!(crate::store::tests::published(&mut hints), [crate::events::Change::Imported]);
        assert_eq!(active_profile(&store).await.as_deref(), Some("deye-sg05lp3"));
        assert_eq!(store.devices().await.expect("devices").len(), 1);
    }

    #[test]
    fn the_guard_reads_the_checked_config_json() {
        let fixture = |case: &str| {
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../../fixtures/oracle/archives")
                .join(case)
                .join("archive.tar.gz")
        };
        let guard = |path: &Path| check(path).and_then(|checked| checked.guard());
        let held = guard(&fixture("current-2.x")).expect("readable").expect("guarded");
        assert_eq!(held.iter().map(|h| h.key.as_str()).collect::<Vec<_>>(), ["1:peak-shaving"]);
        assert!(guard(&fixture("legacy-1.2.0")).expect("readable").is_none());
        let unreadable = |path: &Path| guard(path).expect_err("refused").to_string();
        assert_eq!(unreadable(&file(b"")), "archive: the archive is cut short");
        let state = json!({"plant": {}, "appSettings": [{"key": "automationState", "value": 5}]});
        let broken = file(&gz(&tar(&[
            (
                MANIFEST,
                json!({"format": FORMAT, "formatVersion": 1, "streams": streams(0, 0, 0, 0)})
                    .to_string()
                    .into_bytes(),
            ),
            (config::MEMBER, state.to_string().into_bytes()),
            (CONFIG_LOG, gz(b"")),
            (READINGS, gz(b"")),
        ])));
        assert!(unreadable(&broken).starts_with("config.json: automationState: "), "{}", unreadable(&broken));
    }

    #[tokio::test]
    async fn an_archive_bucket_is_one_reading_at_its_start() {
        let path = archive(&line("daily", "2026-04-28T00:00:00Z", "power", 400.0), &streams(0, 0, 0, 1));
        let (store, imported) = run(&path, "2026-05-02T00:00:00Z").await;
        assert_eq!(imported.expect("import").gaps, []);
        let mut conn = store.hold().await;
        let row = sqlx::query(
            "SELECT tier, start_us, avg, max, min, first_us, first, last_us, last, weighted FROM rollup",
        )
        .fetch_one(&mut *conn)
        .await
        .expect("one bucket");
        let start = at("2026-04-28T00:00:00Z").as_microsecond();
        assert_eq!((row.get::<i64, _>(0), row.get::<i64, _>(1)), (2, start));
        let values: Vec<f64> = (2..5).chain([6, 8, 9]).map(|i| row.get(i)).collect();
        assert_eq!(values, [400.0, 400.0, 400.0, 400.0, 400.0, 0.0]);
        assert_eq!((row.get::<i64, _>(5), row.get::<i64, _>(7)), (start, start));
    }

    #[tokio::test]
    async fn raw_readings_roll_up_and_older_than_retention_keep_only_hours_and_days() {
        // Raw keeps 7 days and minutes 90 by default: the 10-day-old reading keeps its minute, not itself.
        let readings = [
            line("raw", "2026-04-22T12:00:00Z", "power", -300.0),
            line("raw", "2026-04-22T12:00:30Z", "power", 0.0),
            line("raw", "2026-05-01T12:00:00Z", "power", 0.0),
            line("minute", "2026-01-20T08:00:00Z", "power", 5.0),
        ]
        .concat();
        let (store, imported) = run(&archive(&readings, &streams(3, 1, 0, 0)), "2026-05-02T00:00:00Z").await;
        imported.expect("import");
        let id = device(&store).await;
        let kept =
            store.readings(id, 0, at("2026-05-02T00:00:00Z").as_millisecond()).await.expect("readings");
        let kept: Vec<_> = kept.into_iter().map(|s| (s.at_ms, s.values)).collect();
        assert_eq!(kept, [(at("2026-05-01T12:00:00Z").as_millisecond(), vec![("power".to_owned(), 0.0)])]);
        let starts = async |tier| -> Vec<String> {
            store
                .buckets(tier, id, "power")
                .await
                .expect("buckets")
                .iter()
                .map(|b| b.start.to_string())
                .collect()
        };
        assert_eq!(starts(Tier::Minute).await, ["2026-04-22T12:00:00Z", "2026-05-01T12:00:00Z"]);
        assert_eq!(
            starts(Tier::Hour).await,
            ["2026-01-20T08:00:00Z", "2026-04-22T12:00:00Z", "2026-05-01T12:00:00Z"]
        );
        let april = store.buckets(Tier::Minute, id, "power").await.expect("buckets")[0];
        assert_eq!((april.avg, april.max, april.min), (-150.0, 0.0, -300.0));
    }

    #[tokio::test]
    async fn retention_cuts_at_the_instant_the_store_would() {
        // From 2 May: raw keeps from 25 April 00:00, minutes ending after 1 February 00:00.
        let readings = [
            line("raw", "2026-04-24T23:59:59.999Z", "p", 1.0),
            line("raw", "2026-04-25T00:00:00Z", "p", 2.0),
            line("minute", "2026-01-31T23:59:00Z", "p", 3.0),
            line("minute", "2026-02-01T00:00:00Z", "p", 4.0),
        ];
        let (store, imported) =
            run(&archive(&readings.concat(), &streams(2, 2, 0, 0)), "2026-05-02T00:00:00Z").await;
        imported.expect("import");
        let id = device(&store).await;
        let kept =
            store.readings(id, 0, at("2026-05-02T00:00:00Z").as_millisecond()).await.expect("readings");
        assert_eq!(
            kept.iter().map(|s| s.at_ms).collect::<Vec<_>>(),
            [at("2026-04-25T00:00:00Z").as_millisecond()]
        );
        let minutes = store.buckets(Tier::Minute, id, "p").await.expect("minutes");
        assert_eq!(minutes[0].start, at("2026-02-01T00:00:00Z"));
    }

    #[tokio::test]
    async fn one_tier_alone_imports_whole() {
        let readings = [
            line("hourly", "2026-04-01T10:00:00Z", "e", 1.0),
            line("hourly", "2026-04-01T11:00:00Z", "e", 2.0),
        ];
        let (store, imported) =
            run(&archive(&readings.concat(), &streams(0, 0, 2, 0)), "2026-05-02T00:00:00Z").await;
        assert_eq!(imported.expect("import").gaps, []);
        let days = store.buckets(Tier::Day, device(&store).await, "e").await.expect("days");
        assert_eq!((days.len(), days[0].max, days[0].min), (1, 2.0, 1.0));
    }

    fn hours(day: &str, values: impl IntoIterator<Item = f64>) -> String {
        values
            .into_iter()
            .enumerate()
            .map(|(h, v)| line("hourly", &format!("{day}T{h:02}:00:00Z"), "e", v))
            .collect()
    }

    /// Each stored day of `e` as (start, min, max).
    async fn days(store: &Store) -> Vec<(String, f64, f64)> {
        let days = store.buckets(Tier::Day, device(store).await, "e").await.expect("days");
        days.iter().map(|d| (d.start.to_string(), d.min, d.max)).collect()
    }

    #[tokio::test]
    async fn a_daily_day_after_an_hourly_day_leaves_the_hourly_day_whole() {
        let readings =
            hours("2026-04-01", (1..=24).map(f64::from)) + &line("daily", "2026-04-02T00:00:00Z", "e", 100.0);
        let (store, imported) = run(&archive(&readings, &streams(0, 0, 24, 1)), "2026-05-02T00:00:00Z").await;
        assert_eq!(imported.expect("import").gaps, []);
        assert_eq!(
            days(&store).await,
            [
                ("2026-04-01T00:00:00Z".to_owned(), 1.0, 24.0),
                ("2026-04-02T00:00:00Z".to_owned(), 100.0, 100.0)
            ]
        );
    }

    #[tokio::test]
    async fn an_hourly_day_after_a_daily_day_keeps_both() {
        let readings =
            line("daily", "2026-04-01T00:00:00Z", "e", 100.0) + &hours("2026-04-02", (1..=24).map(f64::from));
        let (store, imported) = run(&archive(&readings, &streams(0, 0, 24, 1)), "2026-05-02T00:00:00Z").await;
        assert_eq!(imported.expect("import").gaps, []);
        assert_eq!(
            days(&store).await,
            [
                ("2026-04-01T00:00:00Z".to_owned(), 100.0, 100.0),
                ("2026-04-02T00:00:00Z".to_owned(), 1.0, 24.0)
            ]
        );
    }

    #[tokio::test]
    async fn a_daily_day_after_minute_or_raw_rows_leaves_their_day_whole() {
        for (tier, counts) in [("minute", streams(0, 2, 0, 1)), ("raw", streams(2, 0, 0, 1))] {
            let readings = [
                line(tier, "2026-04-01T22:59:00Z", "e", 1.0),
                line(tier, "2026-04-01T23:59:00Z", "e", 2.0),
                line("daily", "2026-04-02T00:00:00Z", "e", 100.0),
            ];
            let (store, imported) = run(&archive(&readings.concat(), &counts), "2026-04-05T00:00:00Z").await;
            assert_eq!(imported.expect("import").gaps, [], "{tier}");
            assert_eq!(
                days(&store).await,
                [
                    ("2026-04-01T00:00:00Z".to_owned(), 1.0, 2.0),
                    ("2026-04-02T00:00:00Z".to_owned(), 100.0, 100.0)
                ],
                "{tier}"
            );
        }
    }

    #[tokio::test]
    async fn a_day_between_hourly_days_lands_from_its_daily_row() {
        let readings = hours("2026-04-01", (1..=24).map(f64::from))
            + &line("daily", "2026-04-02T00:00:00Z", "e", 100.0)
            + &hours("2026-04-03", (1..=24).map(f64::from));
        let (store, imported) = run(&archive(&readings, &streams(0, 0, 48, 1)), "2026-05-02T00:00:00Z").await;
        assert_eq!(imported.expect("import").gaps, []);
        assert_eq!(
            days(&store).await,
            [
                ("2026-04-01T00:00:00Z".to_owned(), 1.0, 24.0),
                ("2026-04-02T00:00:00Z".to_owned(), 100.0, 100.0),
                ("2026-04-03T00:00:00Z".to_owned(), 1.0, 24.0)
            ]
        );
    }

    #[tokio::test]
    async fn a_day_between_hourly_days_without_a_daily_row_is_a_gap() {
        let readings =
            hours("2026-04-01", (1..=24).map(f64::from)) + &hours("2026-04-03", (1..=24).map(f64::from));
        let (_, imported) = run(&archive(&readings, &streams(0, 0, 48, 0)), "2026-05-02T00:00:00Z").await;
        let gaps: Vec<_> = imported.expect("import").gaps.iter().map(|g| (g.start, g.end)).collect();
        assert_eq!(gaps, [(at("2026-04-02T00:00:00Z"), at("2026-04-03T00:00:00Z"))]);
    }

    #[tokio::test]
    async fn days_before_the_epoch_are_held_by_their_own_rows() {
        let readings = hours("1969-12-31", (1..=24).map(f64::from))
            + &line("daily", "1970-01-01T00:00:00Z", "e", 100.0)
            + &hours("1970-01-02", (1..=24).map(f64::from));
        let (store, imported) = run(&archive(&readings, &streams(0, 0, 48, 1)), "1970-02-02T00:00:00Z").await;
        assert_eq!(imported.expect("import").gaps, []);
        let stored = days(&store).await;
        assert_eq!(
            stored.iter().map(|d| (d.1, d.2)).collect::<Vec<_>>(),
            [(1.0, 24.0), (100.0, 100.0), (1.0, 24.0)]
        );
    }

    #[tokio::test]
    async fn a_daily_row_inside_an_hourly_day_does_not_land() {
        let readings =
            hours("2026-04-01", (1..=24).map(f64::from)) + &line("daily", "2026-04-01T00:00:00Z", "e", 100.0);
        let (store, imported) = run(&archive(&readings, &streams(0, 0, 24, 1)), "2026-05-02T00:00:00Z").await;
        imported.expect("import");
        assert_eq!(days(&store).await, [("2026-04-01T00:00:00Z".to_owned(), 1.0, 24.0)]);
    }

    #[tokio::test]
    async fn lines_at_one_instant_and_tier_with_other_values_are_counted_and_the_first_kept() {
        let readings = [
            line("hourly", "2026-04-01T10:00:00Z", "e", 1.0),
            line("hourly", "2026-04-01T10:00:00Z", "e", 1.0),
            line("hourly", "2026-04-01T10:00:00Z", "e", 2.0),
            line("hourly", "2026-04-01T11:00:00Z", "e", 5.0),
            line("hourly", "2026-04-01T11:00:00Z", "e", 6.0),
            line("raw", "2026-04-01T11:00:00Z", "e", 7.0),
        ];
        let (store, imported) =
            run(&archive(&readings.concat(), &streams(1, 0, 5, 0)), "2026-05-02T00:00:00Z").await;
        let imported = imported.expect("import");
        assert_eq!(imported.conflicts, 2);
        let first = Conflict {
            device: DEVICE.to_owned(),
            metric: "e".to_owned(),
            at: at("2026-04-01T10:00:00Z"),
            kept: 1.0,
            dropped: 2.0,
        };
        assert_eq!(imported.first_conflict, Some(first));
        let hours = store.buckets(Tier::Hour, device(&store).await, "e").await.expect("hours");
        assert_eq!(hours.iter().map(|h| (h.min, h.max)).collect::<Vec<_>>(), [(1.0, 1.0), (5.0, 7.0)]);
    }

    #[tokio::test]
    async fn an_archive_without_readings_imports_its_plant() {
        let (store, imported) = run(&archive("", &streams(0, 0, 0, 0)), "2026-05-02T00:00:00Z").await;
        assert_eq!(imported.expect("import").read, Streams::default());
        assert_eq!(store.devices().await.expect("devices").len(), 1);
        assert_eq!(store.plant_time_zone().await.expect("zone").as_deref(), Some("Europe/Berlin"));
    }

    #[tokio::test]
    async fn a_last_line_without_its_newline_reads_and_one_cut_mid_line_is_refused() {
        let whole = line("raw", "2026-05-01T12:00:00Z", "p", 1.0);
        let path = archive(&format!("\n{}\n\n", whole.trim_end()), &streams(1, 0, 0, 0));
        run(&path, "2026-05-02T00:00:00Z").await.1.expect("a blank last line is no row");
        run(&archive(whole.trim_end(), &streams(1, 0, 0, 0)), "2026-05-02T00:00:00Z")
            .await
            .1
            .expect("no newline");
        let cut = format!("{whole}{}", &whole[..30]);
        assert!(
            refusal(&archive(&cut, &streams(2, 0, 0, 0))).await.starts_with("readings.ndjson.gz: line 2: ")
        );
    }

    #[tokio::test]
    async fn a_member_that_does_not_add_up_is_refused_before_anything_is_written() {
        let one = line("raw", "2026-05-01T12:00:00Z", "p", 1.0);
        assert!(
            refusal(&archive(&one, &streams(2, 0, 0, 0))).await.starts_with("readings.ndjson.gz: holds ")
        );
        let stranger = one.replace(DEVICE, "ghost");
        assert_eq!(
            refusal(&archive(&stranger, &streams(1, 0, 0, 0))).await,
            "readings.ndjson.gz: device ghost is not in config.json"
        );
        assert!(
            refusal(&archive(&line("weekly", "2026-05-01T12:00:00Z", "p", 1.0), &streams(1, 0, 0, 0)))
                .await
                .contains("weekly")
        );
        assert_eq!(refusal(&file(b"")).await, "archive: the archive is cut short");
        let no_log = file(&gz(&tar(&[(MANIFEST, b"{}".to_vec())])));
        assert!(refusal(&no_log).await.starts_with("manifest.json: "));
    }

    #[tokio::test]
    async fn a_newer_format_or_a_missing_member_is_refused_by_name() {
        let manifest = |version: u32| {
            json!({"format": FORMAT, "formatVersion": version, "streams": streams(0, 0, 0, 0)})
                .to_string()
                .into_bytes()
        };
        let newer = file(&gz(&tar(&[(MANIFEST, manifest(2))])));
        assert_eq!(refusal(&newer).await, "manifest.json: format version 2 is newer than this core reads");
        let without = |skip: &str| {
            let all = [
                (MANIFEST, manifest(1)),
                (config::MEMBER, config().into_bytes()),
                (CONFIG_LOG, gz(b"")),
                (READINGS, gz(b"")),
            ];
            file(&gz(&tar(&all.into_iter().filter(|(name, _)| *name != skip).collect::<Vec<_>>())))
        };
        for member in [MANIFEST, config::MEMBER, CONFIG_LOG, READINGS] {
            assert_eq!(refusal(&without(member)).await, format!("{member}: missing"));
        }
    }
}
