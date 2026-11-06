//! Every archive of `fixtures/oracle/archives` imported: row counts, gaps, plant, devices, the readings that
//! landed and their per-day counter energy must equal what the 2.x importer recorded in `expected-import.json`.
//!
//! A bucket an archive row became is one reading at the bucket's start, so the store is read back day by day
//! from its finest record: stored readings, else the finest tier's buckets, each read as `(start, max)`.

#![allow(clippy::expect_used, reason = "helpers outside #[test] fns may panic like the tests")]

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};

use jiff::Timestamp;
use serde_json::{Value, json};
use sunreye::archive::{ImportError, Imported, import};
use sunreye::plant_zone::plant_zone;
use sunreye::profile::Bundle;
use sunreye::rollup::Tier;
use sunreye::sources::{Installed, import_profile};
use sunreye::store::Store;

const DAY_MS: i64 = 86_400_000;

/// `value` with every number as a float: 2.x writes `8000` where the store reads `8000.0`.
fn floats(value: Value) -> Value {
    match value {
        Value::Number(n) => json!(n.as_f64().expect("number")),
        Value::Array(items) => Value::Array(items.into_iter().map(floats).collect()),
        Value::Object(map) => Value::Object(map.into_iter().map(|(k, v)| (k, floats(v))).collect()),
        other => other,
    }
}

fn fixture(case: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/oracle/archives").join(case)
}

fn expected(case: &str) -> Value {
    serde_json::from_str(&std::fs::read_to_string(fixture(case).join("expected-import.json")).expect("read"))
        .expect("json")
}

/// The archive's own clock: its manifest's `createdAt`.
fn created(case: &str) -> Timestamp {
    let text = std::fs::read_to_string(fixture(case).join("manifest.json")).expect("manifest");
    let manifest: Value = serde_json::from_str(&text).expect("json");
    manifest["createdAt"].as_str().expect("createdAt").parse().expect("instant")
}

async fn fresh_store() -> (Store, PathBuf) {
    static NEXT: AtomicUsize = AtomicUsize::new(0);
    let dir = Path::new(env!("CARGO_TARGET_TMPDIR")).join(format!(
        "archive-oracle-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    drop(std::fs::remove_dir_all(&dir));
    (Store::open(&dir).await.expect("open"), dir)
}

/// A profile source supplying the legacy archive's profile, which is not compiled in.
async fn supply_legacy_profile(store: &Store) {
    let text = json!({"id": "oracle-legacy-profile", "name": "Oracle legacy", "manufacturer": "Oracle",
                      "version": "1.0.17", "metrics": []});
    import_profile(store, &Installed::validate(text.to_string()).expect("profile")).await.expect("import");
}

async fn run(case: &str, store: &Store) -> Result<Imported, ImportError> {
    let bundle = Bundle::official().expect("bundle");
    import(store, &bundle, &fixture(case).join("archive.tar.gz"), created(case)).await
}

fn assert_result(imported: &Imported, want: &Value) {
    let read = &imported.read;
    let got = json!({"raw": read.raw, "minute": read.minute, "hourly": read.hourly, "daily": read.daily,
                     "configLog": read.config_log});
    assert_eq!(got, want["result"]["inserted"]);
    let gaps: Vec<Value> = imported
        .gaps
        .iter()
        .map(|g| json!({"start": format!("{:.3}", g.start), "end": format!("{:.3}", g.end)}))
        .collect();
    let want_gaps: Vec<Value> = want["result"]["replays"]
        .as_array()
        .expect("replays")
        .iter()
        .flat_map(|r| r["gaps"].as_array().cloned().expect("gaps"))
        .collect();
    assert_eq!(gaps, want_gaps);
}

async fn assert_graph(store: &Store, want: &Value) {
    assert_eq!(plant_zone(store).await.expect("zone").iana_name(), want["plant"]["time_zone"].as_str());
    let plant = store.plant_settings().await.expect("plant").expect("saved");
    let got = json!({"latitude": plant.latitude, "longitude": plant.longitude, "label": plant.label,
                     "max_output_w": plant.max_output_w, "house_load_w": plant.house_load_w});
    let p = &want["plant"];
    let want_plant = json!({"latitude": p["latitude"], "longitude": p["longitude"], "label": p["label"],
                            "max_output_w": p["max_output_w"], "house_load_w": p["house_load_w"]});
    assert_eq!(floats(got), floats(want_plant));
}

const DEVICE_FIELDS: [&str; 9] = [
    "name",
    "profile_id",
    "role",
    "unit_id",
    "retired_at",
    "connection",
    "usable_kwh",
    "max_charge_w",
    "min_soc",
];

async fn assert_roster(store: &Store, want: &Value) {
    let connections: BTreeMap<i64, Value> = store
        .connections()
        .await
        .expect("connections")
        .into_iter()
        .map(|c| {
            (c.id, json!({"name": c.name, "transport": c.transport.as_str(), "host": c.host, "port": c.port}))
        })
        .collect();
    let want_connections: Vec<Value> = want["connections"]
        .as_array()
        .expect("connections")
        .iter()
        .map(|c| {
            let transport = c["params"]["transport"].as_str().expect("transport").replace('-', "_");
            json!({"name": c["name"], "transport": transport, "host": c["params"]["host"], "port": c["params"]["port"]})
        })
        .collect();
    assert_eq!(connections.values().cloned().collect::<Vec<_>>(), want_connections);
    let pv = store.device_pv().await.expect("pv");
    let devices: Vec<Value> = store
        .devices()
        .await
        .expect("devices")
        .into_iter()
        .map(|d| {
            let battery = pv.get(&d.id).and_then(|p| p.battery.clone());
            json!({"name": d.name, "profile_id": d.profile_id, "role": d.role, "unit_id": d.unit_id,
                   "retired_at": d.retired_at, "connection": connections[&d.connection_id]["name"],
                   "usable_kwh": battery.as_ref().map(|b| b.usable_kwh),
                   "max_charge_w": battery.as_ref().and_then(|b| b.max_charge_w),
                   "min_soc": battery.as_ref().map(|b| b.min_soc)})
        })
        .collect();
    let want_devices: Vec<Value> = want["devices"]
        .as_array()
        .expect("devices")
        .iter()
        .map(|d| Value::Object(DEVICE_FIELDS.iter().map(|k| ((*k).to_owned(), d[*k].clone())).collect()))
        .collect();
    assert_eq!(floats(Value::Array(devices)), floats(Value::Array(want_devices)));
}

/// Each metric's readings as the store holds them: every day from its finest record.
async fn read_back(store: &Store, device: i64, metrics: &[String]) -> BTreeMap<String, Vec<(i64, f64)>> {
    let samples = store.readings(device, i64::MIN / 2, i64::MAX / 2).await.expect("readings");
    let mut out = BTreeMap::new();
    for metric in metrics {
        let mut points: Vec<(i64, f64)> = samples
            .iter()
            .filter_map(|s| s.values.iter().find(|(k, _)| k == metric).map(|(_, v)| (s.at_ms, *v)))
            .collect();
        let mut held: BTreeSet<i64> = points.iter().map(|(at, _)| at.div_euclid(DAY_MS)).collect();
        for tier in [Tier::Minute, Tier::Hour, Tier::Day] {
            let mut found = BTreeSet::new();
            let buckets = store.buckets(tier, device, metric).await.expect("buckets");
            for bucket in
                buckets.iter().filter(|b| !held.contains(&b.start.as_millisecond().div_euclid(DAY_MS)))
            {
                let at = bucket.start.as_millisecond();
                assert_eq!(bucket.max, bucket.min, "{metric} {tier:?} {at}: one reading per archive bucket");
                found.insert(at.div_euclid(DAY_MS));
                points.push((at, bucket.max));
            }
            held.extend(found);
        }
        points.sort_by_key(|p| p.0);
        out.insert(metric.clone(), points);
    }
    out
}

/// 2.x `perDayEnergy` (`packages/db/src/counter-energy.ts`): a step books on its later reading's UTC day, a
/// fall is a restart booking what the counter now reads, both ends clamped at zero.
fn per_day_energy(series: &BTreeMap<String, Vec<(i64, f64)>>) -> Vec<Value> {
    let mut out = Vec::new();
    for (metric, points) in series {
        let mut days: BTreeMap<i64, (f64, u32, f64, f64)> = BTreeMap::new();
        for pair in points.windows(2) {
            let ((_, prev), (at, next)) = (pair[0], pair[1]);
            let (from, to) = (prev.max(0.0), next.max(0.0));
            let row = days.entry(at.div_euclid(DAY_MS)).or_insert((0.0, 0, f64::INFINITY, f64::NEG_INFINITY));
            row.0 += if to < from { to } else { to - from };
            row.1 += u32::from(next < prev);
        }
        for (at, value) in points {
            if let Some(row) = days.get_mut(&at.div_euclid(DAY_MS)) {
                row.2 = row.2.min(*value);
                row.3 = row.3.max(*value);
            }
        }
        for (day, (energy, resets, min, max)) in days {
            let date = Timestamp::from_millisecond(day * DAY_MS).expect("day").to_string()[..10].to_owned();
            out.push(json!({"metric": metric, "day": date, "energy": energy, "naive": max - min, "resets": resets}));
        }
    }
    out
}

fn assert_close(got: &[Value], want: &Value) {
    let want = want.as_array().expect("array");
    assert_eq!(got.len(), want.len(), "{got:?} != {want:?}");
    for (g, w) in got.iter().zip(want) {
        for key in ["metric", "day", "resets"] {
            assert_eq!(g[key], w[key], "{key}: {g} != {w}");
        }
        for key in ["energy", "naive"] {
            let (a, b) = (g[key].as_f64().expect("number"), w[key].as_f64().expect("number"));
            assert!((a - b).abs() < 1e-9, "{key}: {g} != {w}");
        }
    }
}

async fn assert_readings(store: &Store, want: &Value) {
    let metrics: Vec<String> = want["metricKeys"]
        .as_array()
        .expect("keys")
        .iter()
        .map(|k| k["key"].as_str().expect("key").to_owned())
        .collect();
    let devices = store.devices().await.expect("devices");
    assert_eq!(devices.len(), 1, "one device per archive");
    let series = read_back(store, devices[0].id, &metrics).await;
    let got: Vec<Value> = series
        .iter()
        .flat_map(|(metric, points)| {
            points.iter().map(move |(at, value)| {
                let time = format!("{:.3}", Timestamp::from_millisecond(*at).expect("instant"));
                json!({"metric": metric, "time": time, "value": value})
            })
        })
        .collect();
    let landed: Vec<Value> = want["raw"]
        .as_array()
        .expect("raw")
        .iter()
        .map(|r| json!({"metric": r["metric"], "time": r["time"], "value": r["value"]}))
        .collect();
    assert_eq!(floats(Value::Array(got)), floats(Value::Array(landed)));
    assert_close(&per_day_energy(&series), &want["energyPerDay"]);
}

#[tokio::test]
async fn the_current_archive_imports_as_2x_recorded() {
    let (store, dir) = fresh_store().await;
    let want = expected("current-2.x");
    let imported = run("current-2.x", &store).await.expect("import");
    assert_result(&imported, &want);
    assert_graph(&store, &want).await;
    assert_roster(&store, &want).await;
    assert_readings(&store, &want).await;
    store.close().await;
    drop(std::fs::remove_dir_all(dir));
}

#[tokio::test]
async fn the_legacy_archive_imports_as_2x_recorded_once_its_profile_is_supplied() {
    let (store, dir) = fresh_store().await;
    supply_legacy_profile(&store).await;
    let want = expected("legacy-1.2.0");
    let imported = run("legacy-1.2.0", &store).await.expect("import");
    assert_result(&imported, &want);
    assert_graph(&store, &want).await;
    assert_roster(&store, &want).await;
    assert_readings(&store, &want).await;
    store.close().await;
    drop(std::fs::remove_dir_all(dir));
}

#[tokio::test]
async fn an_unresolvable_profile_stops_the_import_with_its_id_and_writes_nothing() {
    let (store, dir) = fresh_store().await;
    let refused = run("legacy-1.2.0", &store).await.expect_err("refused");
    assert!(
        matches!(&refused, ImportError::UnknownProfile(id) if id == "oracle-legacy-profile"),
        "{refused}"
    );
    assert_eq!(store.devices().await.expect("devices"), []);
    assert_eq!(store.connections().await.expect("connections"), []);
    assert_eq!(store.plant_time_zone().await.expect("zone"), None);
    store.close().await;
    drop(std::fs::remove_dir_all(dir));
}

#[tokio::test]
async fn a_second_import_of_the_same_archive_is_refused_and_changes_nothing() {
    let (store, dir) = fresh_store().await;
    run("current-2.x", &store).await.expect("import");
    let refused = run("current-2.x", &store).await.expect_err("refused");
    assert!(matches!(refused, ImportError::NotEmpty), "{refused}");
    assert_eq!(store.devices().await.expect("devices").len(), 1);
    store.close().await;
    drop(std::fs::remove_dir_all(dir));
}
