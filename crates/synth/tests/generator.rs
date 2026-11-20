//! The generator's physics and its determinism, on short spans.
#![cfg(test)]

use std::path::Path;
use std::sync::OnceLock;
use std::time::{Duration, UNIX_EPOCH};

use sunreye_core::bus::Bus;
use sunreye_core::storage::Storage;
use sunreye_synth::home::{HOURS_PER_POLL, Home, Now, POLL, SOC_MAX, SOC_MIN};
use sunreye_synth::model::{Model, Wiring};
use sunreye_synth::{Options, generate, instant, plant, sky};

/// 2026-06-15T00:00:00Z: a week around midsummer.
const JUNE: i64 = 1_781_481_600;
const WEEK: i64 = 7 * 86_400;
const SEED: u64 = 1;

fn wiring(dir: &Path) -> Wiring {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    runtime.block_on(async {
        let bus = Bus::default();
        let storage = Storage::open(&dir.join("core.sqlite"), UNIX_EPOCH, "UTC", &bus).unwrap();
        let registered = plant::register(&storage, &bus, dir, instant(JUNE))
            .await
            .unwrap();
        storage.shutdown().await.unwrap();
        registered.wiring
    })
}

/// Every poll of a June week, computed once for the tests that share it.
fn week() -> &'static [Now] {
    static WEEK_POLLS: OnceLock<Vec<Now>> = OnceLock::new();
    WEEK_POLLS.get_or_init(|| {
        let dir = tempfile::tempdir().unwrap();
        let wiring = wiring(dir.path());
        let sky = sky(SEED);
        let model = Model::run(&wiring, sky, JUNE, JUNE + WEEK);
        let zone = jiff::tz::TimeZone::get(plant::ZONE).unwrap();
        let mut home = Home::new(SEED, sky, zone, wiring.ratings);
        (JUNE..JUNE + WEEK)
            .step_by(5)
            .map(|t| home.step(t, &model))
            .collect()
    })
}

fn elevation(unix: i64) -> f64 {
    let location = sunreye_pv::Location {
        latitude: plant::LATITUDE,
        longitude: plant::LONGITUDE,
    };
    90.0 - sunreye_pv::sun_position(unix, location).zenith
}

fn pv(now: &Now) -> f64 {
    now.inverters.iter().map(|i| i.pv).sum()
}

#[test]
fn pv_is_dark_at_night() {
    let night: Vec<&Now> = week().iter().filter(|n| elevation(n.unix) < -1.0).collect();
    assert!(night.len() > 1_000);
    for now in night {
        assert!(pv(now) == 0.0, "PV at night {}: {}", now.unix, pv(now));
        assert!(now.strings.iter().all(|s| *s == 0.0));
    }
}

#[test]
fn pv_peaks_within_the_hour_of_the_sun() {
    let mut by_hour = [0.0; 24];
    let mut sun = [0.0; 24];
    for now in week() {
        let hour = usize::try_from(now.unix.rem_euclid(86_400) / 3600).unwrap();
        by_hour[hour] += pv(now);
        sun[hour] += elevation(now.unix);
    }
    let peak = |hours: &[f64; 24]| {
        (0..24)
            .max_by(|a, b| hours[*a].total_cmp(&hours[*b]))
            .unwrap()
    };
    assert!(
        peak(&by_hour).abs_diff(peak(&sun)) <= 1,
        "PV peaks at {} UTC, the sun at {}",
        peak(&by_hour),
        peak(&sun)
    );
}

#[test]
fn each_inverters_strings_carry_its_pv() {
    let mut checked = 0;
    for now in week() {
        for (place, inverter) in now.inverters.iter().enumerate() {
            let strings: f64 = now
                .strings
                .iter()
                .zip(plant::STRING_INVERTERS)
                .filter(|(_, i)| *i == place)
                .map(|(s, _)| s)
                .sum();
            if inverter.pv > 500.0 {
                let off = (strings - inverter.pv).abs() / inverter.pv;
                assert!(
                    off < 0.05,
                    "{}: strings {strings}, PV {}",
                    now.unix,
                    inverter.pv
                );
                checked += 1;
            }
        }
    }
    assert!(checked > 10_000);
}

#[test]
fn each_counter_integrates_its_power_over_the_poll() {
    let kwh = |watts: f64| watts * HOURS_PER_POLL / 1_000.0;
    let close = |counter: f64, power: f64| (counter - kwh(power)).abs() < 1e-9;
    for pair in week().windows(2) {
        let [before, now] = pair else { continue };
        assert_eq!(now.unix - before.unix, POLL);
        for (a, b) in before.inverters.iter().zip(&now.inverters) {
            assert!(close(b.energy - a.energy, b.output));
        }
        assert!(close(now.imported - before.imported, now.grid.max(0.0)));
        assert!(close(now.exported - before.exported, (-now.grid).max(0.0)));
        let (a, b) = (before.battery, now.battery);
        assert!(close(b.charged - a.charged, b.power.max(0.0)));
        assert!(close(b.discharged - a.discharged, (-b.power).max(0.0)));
        assert!(close(now.ups_energy - before.ups_energy, now.ups));
    }
}

#[test]
fn the_grid_balances_and_the_battery_cycles_within_its_bounds() {
    for now in week() {
        let output: f64 = now.inverters.iter().map(|i| i.output).sum();
        let used = now.house + now.heat_pump + now.ev.power + now.battery.power;
        assert!(
            (now.grid + output - used).abs() < 1e-6,
            "unbalanced at {}",
            now.unix
        );
        assert!((SOC_MIN..=SOC_MAX).contains(&now.battery.soc));
    }
    let socs = week().iter().map(|n| n.battery.soc);
    let (low, high) = socs.fold((f64::MAX, f64::MIN), |(l, h), s| (l.min(s), h.max(s)));
    assert!(
        high - low > 20.0,
        "the battery barely cycles: {low}..{high}"
    );
}

/// Every row of every table, sorted, but the admin's password hash and the install's identity,
/// which are salted and keyed afresh by the core.
fn rows(path: &Path) -> Vec<(String, Vec<String>)> {
    let db = rusqlite::Connection::open(path).unwrap();
    let tables: Vec<String> = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .unwrap()
        .query_map([], |r| r.get(0))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    tables
        .into_iter()
        .filter(|t| t != "admin" && t != "identity")
        .map(|table| {
            let mut statement = db.prepare(&format!("SELECT * FROM \"{table}\"")).unwrap();
            let columns = statement.column_count();
            let mut rows: Vec<String> = statement
                .query_map([], |r| {
                    (0..columns)
                        .map(|c| {
                            r.get::<_, rusqlite::types::Value>(c)
                                .map(|v| format!("{v:?}"))
                        })
                        .collect::<Result<Vec<_>, _>>()
                        .map(|values| values.join("|"))
                })
                .unwrap()
                .collect::<Result<_, _>>()
                .unwrap();
            rows.sort();
            (table, rows)
        })
        .collect()
}

fn generated(seed: u64) -> (tempfile::TempDir, Vec<(String, Vec<String>)>) {
    let dir = tempfile::tempdir().unwrap();
    let options = Options {
        out: dir.path().to_owned(),
        from: JUNE,
        to: JUNE + 86_400,
        // Half the day as readings, half as hourly values.
        readings: Duration::from_hours(12),
        seed,
    };
    generate(&options).unwrap();
    let rows = rows(&dir.path().join(sunreye_synth::STORE));
    (dir, rows)
}

#[test]
fn a_seed_generates_the_same_store_and_another_seed_another() {
    let (_a, first) = generated(SEED);
    let (_b, again) = generated(SEED);
    let (_c, other) = generated(SEED + 1);

    let count = |rows: &[(String, Vec<String>)], table: &str| {
        rows.iter()
            .find(|(t, _)| t == table)
            .map_or(0, |(_, r)| r.len())
    };
    for table in ["block", "rollup_hour", "forecast"] {
        assert!(count(&first, table) > 0, "no {table}");
    }
    for ((table, a), (_, b)) in first.iter().zip(&again) {
        assert!(a == b, "{table} differs between two runs of one seed");
    }
    assert_eq!(first.len(), again.len());
    assert_ne!(first, other);
}
