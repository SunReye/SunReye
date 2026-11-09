//! The import through its interface, over `fixtures/import/v3-plant.tar.gz`.
//!
//! No export of the owner's dev plant exists on the build host, and no v3 database could be read
//! without risking the live one, so the fixture is representative: written by v3's own archive
//! writer (`packages/db/src/archive-file.ts` and `archive.ts` of the v3 tree, format version 1)
//! from rows shaped like the dev plant's. One Deye SUN-15K device, slug and profile
//! `deye-sun15k-sg05lp3` with the official v3 profile 1.0.17 installed, plant zone
//! Europe/Berlin. In July 2026: UTC days 1 to 3 in the daily tier, 4 and 5 hourly, 6 in the minute
//! tier, and 7 raw, one interval per minute with an outage from 03:00:20 to 03:20 and 2 W of
//! jitter. PV reads 2000 W from 06:00 to 18:00, the battery `-1500` (v3: charging) from 10:00
//! to 14:00 and `800` (discharging) from 18:00 to 22:00, and the production counter rises 0.1 kWh
//! every six minutes of daylight. `battery.daily_charge` has no v5 quantity.

use std::path::PathBuf;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use super::{Error, Options, OptionsError, Report, Target, run};
use crate::bus::{Bus, DeviceId};
use crate::profiles::Catalogue;
use crate::storage::{Aggregate, Backfilled, Storage, Tier};

/// 2026-07-01 00:00 UTC.
const JULY_1: u64 = 1_782_864_000;
const DEVICE: DeviceId = DeviceId(1);
const SLUG: &str = "deye-sun15k-sg05lp3";

fn fixture() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("fixtures/import/v3-plant.tar.gz")
}

/// `hours` after July 1, 00:00 UTC.
fn july(hours: f64) -> SystemTime {
    UNIX_EPOCH + Duration::from_secs(JULY_1) + Duration::from_secs_f64(hours * 3600.0)
}

fn hours(time: SystemTime) -> f64 {
    let since = time.duration_since(july(0.0)).unwrap();
    (since.as_secs_f64() / 360.0).round() / 10.0
}

fn round(v: f64) -> f64 {
    (v * 1e3).round() / 1e3
}

struct Plant {
    bus: Bus,
    storage: Storage,
    _dir: tempfile::TempDir,
}

impl Plant {
    fn new() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let bus = Bus::default();
        let storage = Storage::open(
            &dir.path().join("core.sqlite"),
            UNIX_EPOCH,
            "Europe/Berlin",
            &bus,
        )
        .unwrap();
        Self {
            bus,
            storage,
            _dir: dir,
        }
    }

    async fn import(&self) -> Report {
        let profile = Catalogue::bundled().unwrap().get("deye-sg05lp3").unwrap();
        let targets = vec![Target {
            slug: SLUG.to_owned(),
            device: DEVICE,
            profile,
        }];
        run(
            fixture(),
            &self.storage.importer(),
            &self.bus,
            targets,
            |_, _| {},
        )
        .await
        .unwrap()
    }

    /// Change points from `from` to `to` hours after July 1, as hours and values.
    async fn history(
        &self,
        role: &str,
        index: Option<u32>,
        from: f64,
        to: f64,
    ) -> Vec<(f64, Option<f64>)> {
        let series = self.bus.intern(role, index);
        self.storage
            .history(DEVICE, series, july(from), july(to))
            .await
            .unwrap()
            .into_iter()
            .map(|p| (hours(p.time), p.value.map(round)))
            .collect()
    }

    /// Daily means from `from` to `to` hours, as start, hours covered and mean.
    async fn means(
        &self,
        (role, index): (&str, Option<u32>),
        tier: Tier,
        from: f64,
        to: f64,
    ) -> Vec<(f64, f64, f64)> {
        let series = self.bus.intern(role, index);
        self.storage
            .rollups(DEVICE, series, tier, july(from)..july(to))
            .await
            .unwrap()
            .into_iter()
            .map(|r| match r.aggregate {
                Aggregate::Measurement { duration, mean, .. } => (
                    hours(r.start),
                    round(duration.as_secs_f64() / 3600.0),
                    round(mean),
                ),
                Aggregate::Counter { .. } => panic!("a counter"),
            })
            .collect()
    }

    /// Counter rollups as start, first, last and delta.
    async fn counted(
        &self,
        role: &str,
        tier: Tier,
        from: f64,
        to: f64,
    ) -> Vec<(f64, f64, f64, f64)> {
        let series = self.bus.intern(role, None);
        self.storage
            .rollups(DEVICE, series, tier, july(from)..july(to))
            .await
            .unwrap()
            .into_iter()
            .map(|r| match r.aggregate {
                Aggregate::Counter { first, last, delta } => {
                    (hours(r.start), round(first), round(last), round(delta))
                }
                Aggregate::Measurement { .. } => panic!("a measurement"),
            })
            .collect()
    }
}

#[tokio::test]
async fn raw_rows_become_change_points_in_v5_signs() {
    let plant = Plant::new();
    plant.import().await;

    // July 7 is hours 144 to 168; the outage starts 20 s into 03:00.
    assert_eq!(
        plant.history("pv.mppt.power", Some(1), 144.0, 169.0).await,
        [
            (144.0, Some(0.0)),
            (147.0, None),
            (147.3, Some(0.0)),
            (150.0, Some(2000.0)),
            (162.0, Some(0.0)),
            (168.0, None),
        ]
    );
    assert_eq!(
        plant.history("battery.power", None, 144.0, 169.0).await,
        [
            (144.0, Some(0.0)),
            (147.0, None),
            (147.3, Some(0.0)),
            (154.0, Some(1500.0)),
            (158.0, Some(0.0)),
            (162.0, Some(-800.0)),
            (166.0, Some(0.0)),
            (168.0, None),
        ]
    );
}

#[tokio::test]
async fn hours_and_days_become_rollups_and_the_minute_tier_is_ignored() {
    let plant = Plant::new();
    plant.import().await;

    // Days 1 to 3 from the daily tier, 4 and 5 summed from hours, none on the minute tier's 6th.
    assert_eq!(
        plant
            .means(("pv.mppt.power", Some(1)), Tier::Day, 0.0, 140.0)
            .await,
        [
            (0.0, 24.0, 400.0),
            (24.0, 24.0, 500.0),
            (48.0, 24.0, 300.0),
            (72.0, 24.0, 650.0),
            (96.0, 24.0, 650.0),
        ]
    );
    assert_eq!(
        plant
            .means(("battery.power", None), Tier::Day, 0.0, 72.0)
            .await,
        [(0.0, 24.0, -100.0), (24.0, 24.0, 50.0), (48.0, 24.0, -20.0)]
    );
    assert_eq!(
        plant
            .means(("pv.mppt.power", Some(1)), Tier::Hour, 84.0, 85.0)
            .await,
        [(84.0, 1.0, 1600.0)]
    );
    assert_eq!(
        plant
            .means(("pv.mppt.power", Some(1)), Tier::Hour, 120.0, 144.0)
            .await,
        []
    );
}

#[tokio::test]
async fn counters_carry_their_energy_across_tiers() {
    let plant = Plant::new();
    plant.import().await;

    assert_eq!(
        plant
            .counted("pv.energy.total", Tier::Day, 0.0, 200.0)
            .await,
        [
            (0.0, 4950.0, 4950.0, 0.0),
            (24.0, 4950.0, 4962.0, 12.0),
            (48.0, 4962.0, 4974.0, 12.0),
            (72.0, 4990.0, 4996.0, 6.0),
            (96.0, 4996.0, 5002.0, 6.0),
            // Raw rows roll up into Berlin days: July 7 begins 22:00 UTC the day before.
            (142.0, 5000.0, 5012.0, 12.0),
            (166.0, 5012.0, 5012.0, 0.0),
        ]
    );
}

#[tokio::test]
async fn metrics_without_a_v5_quantity_are_reported_and_a_second_run_changes_nothing() {
    let plant = Plant::new();
    let first = plant.import().await;
    let again = plant.import().await;

    assert_eq!(
        first.unread.into_iter().collect::<Vec<_>>(),
        [format!("{SLUG}/battery.daily_charge")]
    );
    assert!(first.written.points > 0);
    assert_eq!(again.written, Backfilled::default());
}

/// A gzipped tar of `members`, as v3 writes one.
fn archive(dir: &std::path::Path, members: &[(&str, &[u8])]) -> PathBuf {
    use std::io::Write as _;
    let mut tar = Vec::new();
    for (name, body) in members {
        let mut header = [0_u8; 512];
        header[..name.len()].copy_from_slice(name.as_bytes());
        header[124..135].copy_from_slice(format!("{:011o}", body.len()).as_bytes());
        header[156] = b'0';
        header[148..156].fill(b' ');
        let sum: u32 = header.iter().map(|&b| u32::from(b)).sum();
        header[148..155].copy_from_slice(format!("{sum:06o}\0").as_bytes());
        tar.extend_from_slice(&header);
        tar.extend_from_slice(body);
        tar.resize(tar.len().next_multiple_of(512), 0);
    }
    tar.extend_from_slice(&[0; 1024]);
    let path = dir.join("archive.tar.gz");
    let mut gz = flate2::write::GzEncoder::new(
        std::fs::File::create(&path).unwrap(),
        flate2::Compression::default(),
    );
    gz.write_all(&tar).unwrap();
    gz.finish().unwrap();
    path
}

#[tokio::test]
async fn a_newer_format_is_refused_before_anything_is_written() {
    let plant = Plant::new();
    let dir = tempfile::tempdir().unwrap();
    let manifest = br#"{"format":"sunreye-archive","formatVersion":2}"#;
    let file = archive(dir.path(), &[("manifest.json", manifest)]);

    let refused = run(
        file,
        &plant.storage.importer(),
        &plant.bus,
        Vec::new(),
        |_, _| {},
    )
    .await;

    assert!(matches!(refused, Err(Error::Archive(reason)) if reason.contains("version 2")));
}

#[tokio::test]
async fn a_target_the_archive_does_not_hold_is_refused() {
    let plant = Plant::new();
    let profile = Catalogue::bundled().unwrap().get("deye-sg05lp3").unwrap();
    let targets = vec![Target {
        slug: "elsewhere".to_owned(),
        device: DEVICE,
        profile,
    }];

    let refused = run(
        fixture(),
        &plant.storage.importer(),
        &plant.bus,
        targets,
        |_, _| {},
    )
    .await;

    assert!(matches!(refused, Err(Error::UnknownDevice(slug)) if slug == "elsewhere"));
}

fn args(line: &str) -> Vec<String> {
    line.split_whitespace().map(str::to_owned).collect()
}

#[test]
fn the_command_takes_the_file_each_device_mapping_and_the_data_directory() {
    let options = Options::parse(
        args("export.tar.gz --device deye-sun15k-sg05lp3=1 --device=meter=4"),
        |name| (name == "SUNREYE_DATA_DIR").then(|| "/data".to_owned()),
    )
    .unwrap();

    assert_eq!(
        options,
        Options {
            file: PathBuf::from("export.tar.gz"),
            data_dir: PathBuf::from("/data"),
            devices: vec![(SLUG.to_owned(), 1), ("meter".to_owned(), 4)],
        }
    );
}

#[test]
fn the_command_refuses_a_mapping_without_a_device_id() {
    let refused = Options::parse(args("x.tar.gz --data-dir /d --device meter=four"), |_| None);

    assert_eq!(refused, Err(OptionsError::Device("meter=four".to_owned())));
}
