//! Tariff evaluation in the plant timezone, worked by hand, and the tariff device on the bus.

use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use jiff::tz::TimeZone;
use sunreye_profile::Unit;
use tokio::sync::broadcast;

use super::{Band, DEVICE, Days, Prices, Schedule, TariffDevice, Tariffs, Version, in_force, wake};
use crate::bus::{Bus, Reading};
use crate::plant;
use crate::storage::Storage;

mod reprice;

fn instant(text: &str) -> SystemTime {
    text.parse::<jiff::Timestamp>().unwrap().into()
}

fn berlin() -> TimeZone {
    TimeZone::get("Europe/Berlin").unwrap()
}

/// From `from` to `to` minutes of the plant-local day.
fn band(days: &[u8], from: u16, to: u16, price: f64) -> Band {
    Band {
        days: Days::of(days).unwrap(),
        from,
        to,
        price,
    }
}

const EVERY_DAY: &[u8] = &[1, 2, 3, 4, 5, 6, 7];

/// 0.30 EUR/kWh, 0.20 at night from 00:00 to 06:00; 0.08 paid for feed-in.
fn night_rate(applies_from: &str) -> Version {
    Version {
        applies_from: instant(applies_from),
        import: Schedule {
            price: 0.30,
            bands: vec![band(EVERY_DAY, 0, 6 * 60, 0.20)],
        },
        export: Schedule {
            price: 0.08,
            bands: vec![],
        },
    }
}

fn import(version: &Version, zone: &TimeZone, at: &str) -> f64 {
    version.prices(zone, instant(at)).import
}

/// The minutes of the plant-local day starting at `midnight` (UTC) whose import price is `price`.
fn minutes_at(version: &Version, zone: &TimeZone, midnight: &str, hours: i64, price: f64) -> usize {
    let start = midnight.parse::<jiff::Timestamp>().unwrap();
    (0..hours * 60)
        .map(|minute| start + jiff::SignedDuration::from_mins(minute))
        .filter(|t| version.prices(zone, (*t).into()).import.to_bits() == price.to_bits())
        .count()
}

#[test]
fn a_fixed_tariff_charges_one_price_at_every_instant() {
    let fixed = Version {
        import: Schedule {
            price: 0.32,
            bands: vec![],
        },
        ..night_rate("2026-01-01T00:00:00Z")
    };

    assert_eq!(
        fixed.prices(&berlin(), instant("2026-07-01T12:34:56Z")),
        Prices {
            import: 0.32,
            export: 0.08
        }
    );
}

#[test]
fn a_band_applies_on_plant_local_wall_clock_time() {
    let night = night_rate("2026-01-01T00:00:00Z");
    let zone = berlin();

    // Winter, UTC+1: the band ends at 06:00 CET, 05:00 UTC.
    assert_eq!(import(&night, &zone, "2026-01-14T04:59:00Z"), 0.20);
    assert_eq!(import(&night, &zone, "2026-01-14T05:00:00Z"), 0.30);
    // Summer, UTC+2: it begins at 00:00 CEST, 22:00 UTC the evening before.
    assert_eq!(import(&night, &zone, "2026-07-14T21:59:00Z"), 0.30);
    assert_eq!(import(&night, &zone, "2026-07-14T22:00:00Z"), 0.20);
    assert_eq!(import(&night, &zone, "2026-07-15T03:59:00Z"), 0.20);
    assert_eq!(import(&night, &zone, "2026-07-15T04:00:00Z"), 0.30);
}

#[test]
fn a_night_band_lasts_five_hours_on_the_23_hour_day() {
    let night = night_rate("2026-01-01T00:00:00Z");
    let zone = berlin();

    // 2026-03-29 begins at 00:00 CET (23:00 UTC the day before); clocks jump from 02:00 CET to
    // 03:00 CEST at 01:00 UTC, so 06:00 CEST is 04:00 UTC: five hours in the band.
    assert_eq!(import(&night, &zone, "2026-03-29T00:59:00Z"), 0.20);
    assert_eq!(import(&night, &zone, "2026-03-29T01:00:00Z"), 0.20);
    assert_eq!(import(&night, &zone, "2026-03-29T03:59:00Z"), 0.20);
    assert_eq!(import(&night, &zone, "2026-03-29T04:00:00Z"), 0.30);
    assert_eq!(
        minutes_at(&night, &zone, "2026-03-28T23:00:00Z", 23, 0.20),
        5 * 60
    );
    assert_eq!(
        minutes_at(&night, &zone, "2026-03-28T23:00:00Z", 23, 0.30),
        18 * 60
    );
}

#[test]
fn a_night_band_lasts_seven_hours_on_the_25_hour_day() {
    let night = night_rate("2026-01-01T00:00:00Z");
    let zone = berlin();

    // 2026-10-25 begins at 00:00 CEST (22:00 UTC the day before); clocks fall back from 03:00
    // CEST to 02:00 CET at 01:00 UTC, so 06:00 CET is 05:00 UTC: seven hours in the band.
    assert_eq!(import(&night, &zone, "2026-10-24T21:59:00Z"), 0.30);
    assert_eq!(import(&night, &zone, "2026-10-24T22:00:00Z"), 0.20);
    assert_eq!(import(&night, &zone, "2026-10-25T04:59:00Z"), 0.20);
    assert_eq!(import(&night, &zone, "2026-10-25T05:00:00Z"), 0.30);
    assert_eq!(
        minutes_at(&night, &zone, "2026-10-24T22:00:00Z", 25, 0.20),
        7 * 60
    );
    assert_eq!(
        minutes_at(&night, &zone, "2026-10-24T22:00:00Z", 25, 0.30),
        18 * 60
    );
}

#[test]
fn a_band_in_the_skipped_hour_never_applies_and_in_the_repeated_hour_applies_twice() {
    let mut version = night_rate("2026-01-01T00:00:00Z");
    version.import.bands = vec![band(EVERY_DAY, 2 * 60, 3 * 60, 0.10)];
    let zone = berlin();

    // 02:00 to 03:00 does not exist on 2026-03-29.
    assert_eq!(
        minutes_at(&version, &zone, "2026-03-28T23:00:00Z", 23, 0.10),
        0
    );
    // It runs twice on 2026-10-25: 02:00 CEST (00:00 UTC) to 02:59 CET (01:59 UTC).
    assert_eq!(import(&version, &zone, "2026-10-24T23:59:00Z"), 0.30);
    assert_eq!(import(&version, &zone, "2026-10-25T00:00:00Z"), 0.10);
    assert_eq!(import(&version, &zone, "2026-10-25T01:59:00Z"), 0.10);
    assert_eq!(import(&version, &zone, "2026-10-25T02:00:00Z"), 0.30);
    assert_eq!(
        minutes_at(&version, &zone, "2026-10-24T22:00:00Z", 25, 0.10),
        2 * 60
    );
}

#[test]
fn a_band_applies_only_on_its_plant_local_weekdays() {
    let mut version = night_rate("2026-01-01T00:00:00Z");
    // Monday to Friday, 08:00 to 20:00.
    version.import.bands = vec![band(&[1, 2, 3, 4, 5], 8 * 60, 20 * 60, 0.35)];
    let zone = berlin();

    // Monday 2026-11-09, 08:00 CET.
    assert_eq!(import(&version, &zone, "2026-11-09T06:59:00Z"), 0.30);
    assert_eq!(import(&version, &zone, "2026-11-09T07:00:00Z"), 0.35);
    // Friday 2026-11-13, 19:59 CET, then 20:00.
    assert_eq!(import(&version, &zone, "2026-11-13T18:59:00Z"), 0.35);
    assert_eq!(import(&version, &zone, "2026-11-13T19:00:00Z"), 0.30);
    // Saturday 2026-11-14, 12:00 CET.
    assert_eq!(import(&version, &zone, "2026-11-14T11:00:00Z"), 0.30);
    // Sunday 23:30 UTC is already Monday 00:30 CET, still outside the band.
    assert_eq!(import(&version, &zone, "2026-11-15T23:30:00Z"), 0.30);
}

#[test]
fn feed_in_has_bands_of_its_own() {
    let mut version = night_rate("2026-01-01T00:00:00Z");
    version.export.bands = vec![band(EVERY_DAY, 11 * 60, 15 * 60, 0.0)];

    let noon = version.prices(&TimeZone::UTC, instant("2026-06-01T12:00:00Z"));

    assert_eq!(
        noon,
        Prices {
            import: 0.30,
            export: 0.0
        }
    );
}

#[test]
fn the_version_in_force_is_the_latest_applying_by_then() {
    let versions = [
        night_rate("2026-01-01T00:00:00Z"),
        night_rate("2026-06-01T00:00:00Z"),
    ];

    assert!(in_force(&versions, instant("2025-12-31T23:59:59Z")).is_none());
    assert_eq!(
        in_force(&versions, instant("2026-05-31T23:59:59Z"))
            .unwrap()
            .applies_from,
        instant("2026-01-01T00:00:00Z")
    );
    assert_eq!(
        in_force(&versions, instant("2026-06-01T00:00:00Z"))
            .unwrap()
            .applies_from,
        instant("2026-06-01T00:00:00Z")
    );
}

#[test]
fn the_device_wakes_at_the_next_minute_or_the_next_version_if_sooner() {
    let versions = [night_rate("2026-06-01T12:00:45Z")];

    assert_eq!(
        wake(&versions, instant("2026-06-01T12:00:30Z")),
        instant("2026-06-01T12:00:45Z")
    );
    assert_eq!(
        wake(&versions, instant("2026-06-01T12:00:45Z")),
        instant("2026-06-01T12:01:00Z")
    );
    assert_eq!(
        wake(&versions, instant("2026-06-01T12:01:00Z")),
        instant("2026-06-01T12:02:00Z")
    );
}

/// A plant in Europe/Berlin with the night rate, and its tariff device started at `start` on a
/// paused Tokio clock.
struct Site {
    _dir: tempfile::TempDir,
    bus: Bus,
    storage: Storage,
    tariffs: Tariffs,
    readings: broadcast::Receiver<Reading>,
    /// Every reading of the device received, as (role, instant, value).
    seen: Vec<(String, String, f64)>,
    _device: TariffDevice,
}

/// Runs `job` to completion on a runtime of its own while the test's paused runtime is blocked,
/// so no virtual time passes while it waits on the storage thread.
fn frozen<T: Send>(job: impl Future<Output = T> + Send) -> T {
    std::thread::scope(|scope| {
        scope
            .spawn(|| {
                let runtime = tokio::runtime::Builder::new_current_thread()
                    .build()
                    .unwrap();
                runtime.block_on(job)
            })
            .join()
            .unwrap()
    })
}

/// Inside a paused Tokio runtime.
fn site(start: &str) -> Site {
    let dir = tempfile::tempdir().unwrap();
    let bus = Bus::default();
    let storage = Storage::open(
        &dir.path().join("core.sqlite"),
        UNIX_EPOCH,
        "Europe/Berlin",
        &bus,
    )
    .unwrap();
    let tariffs = Tariffs::new(&storage, &bus, berlin());
    frozen(tariffs.change(
        night_rate("2026-01-01T00:00:00Z"),
        instant("2026-01-01T00:00:00Z"),
    ))
    .unwrap();
    let start = instant(start);
    let paused = tokio::time::Instant::now();
    let clock = Arc::new(move || start + paused.elapsed());
    let readings = bus.subscribe();
    let device = TariffDevice::spawn(tariffs.clone(), clock);
    Site {
        _dir: dir,
        bus,
        storage,
        tariffs,
        readings,
        seen: Vec::new(),
        _device: device,
    }
}

impl Site {
    /// The device's readings of `role` until it publishes `value`, as (instant, value).
    async fn until(&mut self, role: &str, value: f64) -> Vec<(String, f64)> {
        let of_role = |seen: &[(String, String, f64)]| -> Vec<(String, f64)> {
            seen.iter()
                .filter(|(r, ..)| r == role)
                .map(|(_, at, value)| (at.clone(), *value))
                .collect()
        };
        loop {
            let found = self
                .seen
                .iter()
                .any(|(r, _, v)| r == role && v.to_bits() == value.to_bits());
            if found {
                return of_role(&self.seen);
            }
            let reading = self.readings.recv().await.unwrap();
            if reading.device != DEVICE {
                continue;
            }
            let role = self.bus.series(reading.series).unwrap().role;
            let at = jiff::Timestamp::try_from(reading.time).unwrap().to_string();
            self.seen.push((role, at, reading.value));
        }
    }
}

#[tokio::test(start_paused = true)]
async fn the_device_publishes_each_price_from_the_instant_it_begins() {
    let mut site = site("2026-03-29T03:58:30Z");

    // 06:00 CEST on the 23-hour day ends the night band.
    assert_eq!(
        site.until("price.import", 0.30).await,
        [
            ("2026-03-29T03:58:30Z".to_owned(), 0.20),
            ("2026-03-29T03:59:00Z".to_owned(), 0.20),
            ("2026-03-29T04:00:00Z".to_owned(), 0.30),
        ]
    );
    // Feed-in has no band: one price throughout.
    let export = site.until("price.export", 0.08).await;
    assert_eq!(export[0], ("2026-03-29T03:58:30Z".to_owned(), 0.08));
    assert!(
        export
            .iter()
            .all(|&(_, price)| price.to_bits() == 0.08_f64.to_bits())
    );
}

#[tokio::test(start_paused = true)]
async fn a_new_version_is_published_from_the_instant_it_applies() {
    let mut site = site("2026-07-01T12:00:00Z");
    site.until("price.import", 0.30).await;

    let mut dearer = night_rate("2026-07-01T12:00:20Z");
    dearer.import.price = 0.40;
    frozen(site.tariffs.change(dearer, instant("2026-07-01T12:00:00Z"))).unwrap();

    assert_eq!(
        site.until("price.import", 0.40).await,
        [
            ("2026-07-01T12:00:00Z".to_owned(), 0.30),
            // Read again at the change.
            ("2026-07-01T12:00:00Z".to_owned(), 0.30),
            ("2026-07-01T12:00:20Z".to_owned(), 0.40),
        ]
    );
}

#[tokio::test(start_paused = true)]
async fn the_prices_are_stored_as_change_points() {
    let mut site = site("2026-03-29T03:58:30Z");
    site.until("price.import", 0.30).await;
    let series = site.bus.intern("price.import", None);
    let from = instant("2026-03-29T03:58:00Z");
    let to = instant("2026-03-29T04:02:00Z");

    // Storage hears the bus on its own task: asked until both prices are history.
    let mut history = Vec::new();
    while history.len() < 2 {
        tokio::task::yield_now().await;
        history = frozen(async {
            site.storage.tick(to).await.unwrap();
            site.storage
                .history(DEVICE, series, from, to)
                .await
                .unwrap()
        });
    }

    // To a thousandth of a cent, the step they are stored in.
    let stored: Vec<(SystemTime, Option<String>)> = history
        .iter()
        .map(|p| (p.time, p.value.map(|v| format!("{v:.5}"))))
        .collect();
    assert_eq!(
        stored,
        [
            (instant("2026-03-29T03:58:30Z"), Some("0.20000".to_owned())),
            (instant("2026-03-29T04:00:00Z"), Some("0.30000".to_owned())),
        ]
    );
}

impl Site {
    /// The plant's grid power and house load, in W, at `at`.
    fn plant(&self, at: &str, grid: f64, load: f64) {
        for (role, value) in [("grid.power", grid), ("load.power", load)] {
            self.bus.publish(Reading {
                device: plant::DEVICE,
                series: self.bus.intern(role, None),
                value,
                unit: Some(Unit::Watt),
                time: instant(at),
            });
        }
    }
}

#[tokio::test(start_paused = true)]
async fn the_device_publishes_cost_rates_from_the_plant_and_the_prices_in_force() {
    let mut site = site("2026-03-29T03:59:50Z");
    site.until("price.import", 0.20).await;

    // 2 kW bought for a 2 kW house at 0.20, then at 0.30 once the night band ends.
    site.plant("2026-03-29T03:59:50Z", 2000.0, 2000.0);
    site.plant("2026-03-29T03:59:55Z", 2000.0, 2000.0);
    let import = site.until("cost.import.rate", 0.60).await;

    assert_eq!(
        import.first(),
        Some(&("2026-03-29T03:59:50Z".to_owned(), 0.40))
    );
    assert_eq!(
        import.last(),
        Some(&("2026-03-29T04:00:00Z".to_owned(), 0.60))
    );
    let savings = site.until("cost.savings.rate", 0.0).await;
    assert!(savings.iter().all(|&(_, rate)| rate == 0.0));
}

#[tokio::test(start_paused = true)]
async fn no_cost_is_published_from_a_silent_plant() {
    let mut site = site("2026-03-29T03:59:00Z");
    site.until("price.import", 0.20).await;
    site.plant("2026-03-29T03:59:00Z", 2000.0, 2000.0);
    site.until("cost.import.rate", 0.40).await;

    // The plant falls silent while the night band ends, then speaks again.
    site.until("price.import", 0.30).await;
    site.plant("2026-03-29T04:00:30Z", 2000.0, 2000.0);
    site.until("cost.import.rate", 0.60).await;

    let costs: Vec<&str> = site
        .seen
        .iter()
        .filter(|(role, ..)| role == "cost.import.rate")
        .map(|(_, at, _)| at.as_str())
        .collect();
    assert_eq!(costs.first(), Some(&"2026-03-29T03:59:00Z"));
    assert!(
        costs
            .iter()
            .all(|at| ["2026-03-29T03:59:00Z", "2026-03-29T04:00:30Z"].contains(at))
    );
}
