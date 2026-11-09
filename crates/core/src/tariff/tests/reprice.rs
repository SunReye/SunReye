//! Repricing a past day from the plant's stored flows: the day's money worked by hand.

use std::time::SystemTime;

use sunreye_profile::{RoleKind, Unit};

use super::{EVERY_DAY, band, berlin, instant, night_rate};
use crate::bus::{Bus, Series};
use crate::endpoint::CADENCE;
use crate::plant;
use crate::storage::{Aggregate, ChangePoint, Policy, Storage, Tier};
use crate::tariff::{DEVICE, Schedule, Tariffs, Version};

/// A plant in Europe/Berlin whose grid power and house load are stored, and nothing priced yet.
struct Past {
    _dir: tempfile::TempDir,
    bus: Bus,
    storage: Storage,
    tariffs: Tariffs,
}

impl Past {
    /// Inside a Tokio runtime.
    fn new() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let bus = Bus::default();
        let storage = Storage::open(
            &dir.path().join("core.sqlite"),
            std::time::UNIX_EPOCH,
            "Europe/Berlin",
            &bus,
        )
        .unwrap();
        let tariffs = Tariffs::new(&storage, &bus, tokio::sync::watch::channel(berlin()).1);
        Self {
            _dir: dir,
            bus,
            storage,
            tariffs,
        }
    }

    /// The plant's grid power and house load in W, each from its instant to the next; `None`
    /// ends them in a gap.
    async fn flows(&self, flows: &[(&str, Option<(f64, f64)>)]) {
        let policy = Policy::new(RoleKind::Measurement, Some(Unit::Watt), 1.0, CADENCE);
        for (role, pick) in [("grid.power", 0), ("load.power", 1)] {
            let series = self.bus.intern(role, None);
            self.storage
                .declare(plant::DEVICE, series, policy)
                .await
                .unwrap();
            let points: Vec<ChangePoint> = flows
                .iter()
                .map(|&(at, watts)| ChangePoint {
                    time: instant(at),
                    value: watts.map(|(grid, load)| if pick == 0 { grid } else { load }),
                })
                .collect();
            let range = points[0].time..points[points.len() - 1].time + CADENCE;
            self.storage
                .replace(plant::DEVICE, series, range, points)
                .await
                .unwrap();
        }
    }

    /// Reprices from the version's date at `now`, once the hours to `now` are rolled up.
    async fn reprice(&self, version: Version, now: &str) {
        self.storage.tick(instant(now)).await.unwrap();
        self.tariffs.reprice(version, instant(now)).await.unwrap();
    }

    /// The day's EUR of each `cost.*` rate, to the cent, and the hours the day lasts.
    async fn day(&self, start: &str) -> ([String; 3], f64) {
        let mut euros = Vec::new();
        let mut hours = 0.0;
        for role in ["cost.import.rate", "cost.export.rate", "cost.savings.rate"] {
            let series = Series {
                role: role.to_owned(),
                index: None,
            };
            let day = self
                .storage
                .reader()
                .rollups(
                    DEVICE,
                    &series,
                    Tier::Day,
                    instant(start)..instant(start) + CADENCE,
                )
                .await
                .unwrap();
            let [rollup] = day.as_slice() else {
                panic!("{role}: {day:?}");
            };
            hours = (rollup
                .end
                .duration_since(rollup.start)
                .unwrap()
                .as_secs_f64())
                / 3600.0;
            let Aggregate::Measurement { integral, .. } = rollup.aggregate else {
                panic!("a counter");
            };
            euros.push(format!("{:.2}", integral + 0.0));
        }
        (euros.try_into().unwrap(), hours)
    }
}

/// Negative prices from 11:00 to 15:00: 0.30 bought and 0.08 fed in otherwise.
fn sunny_sunday(applies_from: &str) -> Version {
    Version {
        applies_from: instant(applies_from),
        import: Schedule {
            price: 0.30,
            bands: vec![band(EVERY_DAY, 11 * 60, 15 * 60, -0.10)],
        },
        export: Schedule {
            price: 0.08,
            bands: vec![band(EVERY_DAY, 11 * 60, 15 * 60, -0.05)],
        },
    }
}

#[tokio::test]
async fn a_day_with_negative_prices_comes_out_to_the_cent() {
    let past = Past::new();
    // Sunday 2026-05-10, CEST: local midnight is 22:00 UTC the day before.
    past.flows(&[
        // 00:00 to 11:00: 500 W bought for a 500 W house.
        ("2026-05-09T22:00:00Z", Some((500.0, 500.0))),
        // 11:00 to 13:00: 1 kW bought at −0.10, 600 W of it into the battery.
        ("2026-05-10T09:00:00Z", Some((1000.0, 400.0))),
        // 13:00 to 15:00: the battery full, 1 kW fed in at −0.05.
        ("2026-05-10T11:00:00Z", Some((-1000.0, 400.0))),
        // 15:00 to 19:00: 2 kW fed in at 0.08.
        ("2026-05-10T13:00:00Z", Some((-2000.0, 600.0))),
        // 19:00 to 24:00: 800 W bought for an 800 W house.
        ("2026-05-10T17:00:00Z", Some((800.0, 800.0))),
        ("2026-05-10T22:00:00Z", None),
    ])
    .await;

    past.reprice(sunny_sunday("2026-05-09T22:00:00Z"), "2026-05-11T00:00:00Z")
        .await;

    // Paid: 11 h × 0.5 kW × 0.30 + 2 h × 1 kW × −0.10 + 5 h × 0.8 kW × 0.30 = 1.65 − 0.20 + 1.20.
    // Earned: 2 h × 1 kW × −0.05 + 4 h × 2 kW × 0.08 = −0.10 + 0.64.
    // Without the plant the house buys 5.5 kWh and 4 kWh at 0.30, 0.8 kWh twice at −0.10 and
    // 2.4 kWh at 0.30: 3.41. With it: 2.65 − 0.54 = 2.11. Saved: 1.30.
    assert_eq!(
        past.day("2026-05-09T22:00:00Z").await,
        (["2.65".into(), "0.54".into(), "1.30".into()], 24.0)
    );
}

#[tokio::test]
async fn the_23_hour_day_prices_five_night_hours() {
    let past = Past::new();
    // 2026-03-29 runs from 23:00 UTC to 22:00 UTC: the clocks skip 02:00 to 03:00.
    past.flows(&[
        ("2026-03-28T23:00:00Z", Some((1000.0, 1000.0))),
        // 12:00 to 14:00 CEST: 1.5 kW fed in, 500 W used.
        ("2026-03-29T10:00:00Z", Some((-1500.0, 500.0))),
        ("2026-03-29T12:00:00Z", Some((1000.0, 1000.0))),
        ("2026-03-29T22:00:00Z", None),
    ])
    .await;

    past.reprice(night_rate("2026-03-28T23:00:00Z"), "2026-03-30T00:00:00Z")
        .await;

    // Paid: 5 night hours × 1 kW × 0.20 + 16 day hours × 1 kW × 0.30 = 1.00 + 4.80.
    // Earned: 2 h × 1.5 kW × 0.08. Saved: 2 h × (0.5 kW × 0.30 + 0.12).
    assert_eq!(
        past.day("2026-03-28T23:00:00Z").await,
        (["5.80".into(), "0.24".into(), "0.54".into()], 23.0)
    );
}

#[tokio::test]
async fn repricing_rewrites_the_prices_from_the_date_on() {
    let past = Past::new();
    past.flows(&[
        ("2026-05-09T22:00:00Z", Some((500.0, 500.0))),
        ("2026-05-10T22:00:00Z", None),
    ])
    .await;

    past.reprice(sunny_sunday("2026-05-10T00:00:00Z"), "2026-05-11T00:00:00Z")
        .await;

    let series = past.bus.intern("price.import", None);
    let prices: Vec<(SystemTime, Option<f64>)> = past
        .storage
        .history(
            DEVICE,
            series,
            instant("2026-05-09T00:00:00Z"),
            instant("2026-05-11T00:00:00Z"),
        )
        .await
        .unwrap()
        .into_iter()
        .map(|p| (p.time, p.value.map(|v| (v * 1e5).round() / 1e5)))
        .collect();
    assert_eq!(
        prices,
        [
            (instant("2026-05-10T00:00:00Z"), Some(0.30)),
            (instant("2026-05-10T09:00:00Z"), Some(-0.10)),
            (instant("2026-05-10T13:00:00Z"), Some(0.30)),
        ]
    );
}
