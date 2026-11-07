//! `source=plant` reads and `GET /api/sources`, held against `fixtures/oracle/README.md` §7.

use std::collections::BTreeMap;

use super::reads::plain_user;
use super::*;
use crate::modbus::Transport;
use crate::oracle::{as_floats, oracle};
use crate::samples::{ClosedMinute, Sample, minute_of};
use crate::store::{DeviceEdit, NewConnection, NewDevice};
use crate::support::core_at;

/// The instant every `plant.ndjson` case folds at.
const AT: &str = "2026-03-01T00:02:30Z";
const NOW: i64 = 1_772_323_350_000;

fn text(value: &Value) -> &str {
    value.as_str().unwrap_or_else(|| panic!("a string: {value}"))
}

/// A core at [`NOW`] cutting plant days in the cases' recorded `UTC`, not the host's zone.
async fn recorded_core(name: &str) -> (Arc<Core>, Api) {
    signed_in(core_at(&dir(name), AT, "UTC").await, &Config::default()).await
}

/// A [`recorded_core`] holding the case's roster, each device under the id its slug names.
async fn with_roster(name: &str, case: &Value) -> (Arc<Core>, Api) {
    let (core, admin) = recorded_core(name).await;
    for (index, row) in case["devices"].as_array().expect("devices").iter().enumerate() {
        let connection = NewConnection {
            transport: Transport::Tcp,
            host: format!("10.0.2.{index}"),
            port: 502,
            logger_serial: None,
        };
        let connection = core.store.add_connection(&connection).await.expect("connection");
        let profile = row["profileId"].as_str().unwrap_or(PROFILE);
        let device = NewDevice { connection_id: connection, profile_id: profile.into(), unit_id: 1 };
        let id = core
            .store
            .create_device(&device, Some(text(&row["name"])), text(&row["role"]))
            .await
            .expect("device");
        assert_eq!(id.to_string(), text(&row["slug"]));
        if let Some(at) = row["retiredAt"].as_str() {
            let retire = DeviceEdit { retired_at: Some(Some(at.into())), ..DeviceEdit::default() };
            core.store.edit_device(id, &retire).await.expect("retire");
        }
    }
    assert_roles_are_the_profiles(&core, case).await;
    (core, admin)
}

/// The case's roles are what the profile the plant folds by gives those keys.
async fn assert_roles_are_the_profiles(core: &Core, case: &Value) {
    let profile = core.profile(PROFILE).await.expect("store").expect("profile");
    for (key, role) in case["roles"].as_object().expect("roles") {
        let metric = profile.metrics.iter().find(|m| m.key == *key).expect("metric");
        assert_eq!(metric.role.as_deref(), role.as_str(), "{key}");
    }
}

/// Each instant of a minute with the values read at it.
type Instants = BTreeMap<i64, Vec<(String, f64)>>;

/// Stores `readings` of `(at_ms, metric, value)` a minute at a time, as the poller closes them.
async fn store(core: &Core, device: i64, readings: &[(i64, String, f64)]) {
    let mut minutes: BTreeMap<i64, Instants> = BTreeMap::new();
    for (at_ms, key, value) in readings {
        let instants = minutes.entry(minute_of(*at_ms)).or_default();
        instants.entry(*at_ms).or_default().push((key.clone(), *value));
    }
    for (minute, instants) in minutes {
        let samples = instants.into_iter().map(|(at_ms, values)| Sample { at_ms, values }).collect();
        core.store.append_minute(device, &ClosedMinute { minute, samples }).await.expect("append");
    }
}

async fn finish(core: Arc<Core>, api: Api) {
    drop(api);
    core.stop().await;
}

/// A device's own recent history as the readings that answer it: one per step, at the step's start.
fn backfill_readings(backfill: &Value) -> Vec<(i64, String, f64)> {
    let (t0, step) = (backfill["t0"].as_i64().expect("t0"), backfill["step"].as_i64().expect("step"));
    let mut readings = Vec::new();
    for (key, series) in backfill["metrics"].as_object().expect("metrics") {
        let (o, v) = (series["o"].as_array().expect("o"), series["v"].as_array().expect("v"));
        for (o, v) in o.iter().zip(v) {
            readings.push((
                t0 + o.as_i64().expect("offset") * step * 1000,
                key.clone(),
                v.as_f64().expect("value"),
            ));
        }
    }
    readings
}

#[tokio::test(start_paused = true)]
async fn plant_recent_history_folds_every_history_members_own_as_recorded() {
    for case in oracle("plant.ndjson") {
        let name = text(&case["case"]).to_owned();
        let (core, admin) = with_roster(&format!("plant-recent-{name}"), &case).await;
        for (slug, backfill) in case["recent"].as_object().expect("recent") {
            store(&core, slug.parse().expect("id"), &backfill_readings(backfill)).await;
        }
        let answer = get(&admin, "/api/history/recent?source=plant").await;
        assert_eq!(answer.status, StatusCode::OK, "{name}");
        assert_eq!(as_floats(&answer.json()), as_floats(&case["plant"]["recent"]), "{name}");
        finish(core, admin).await;
    }
}

fn readings(device: &Value) -> Vec<(i64, String, f64)> {
    let mut out = Vec::new();
    for (key, series) in device["readings"].as_object().expect("readings") {
        for reading in series.as_array().expect("series") {
            let at: jiff::Timestamp = text(&reading[0]).parse().expect("RFC 3339");
            out.push((at.as_millisecond(), key.clone(), reading[1].as_f64().expect("value")));
        }
    }
    out
}

async fn assert_plant_minutes(admin: &Api, label: &str, query: &str, recorded: &Value) {
    let answer = get(admin, &format!("/api/history/rollup?bucket=minute&source=plant&{query}")).await;
    if let Some(refused) = recorded["refused"].as_str() {
        let want = (StatusCode::UNPROCESSABLE_ENTITY, json!({"error": refused}));
        assert_eq!((answer.status, answer.json()), want, "{label}");
    } else {
        assert_eq!(answer.status, StatusCode::OK, "{label}");
        assert_eq!(as_floats(&answer.json()), as_floats(recorded), "{label}");
    }
}

#[tokio::test(start_paused = true)]
async fn plant_minute_rollups_fold_every_history_members_own_as_recorded() {
    for case in oracle("plant-rollups.ndjson") {
        let name = text(&case["case"]).to_owned();
        let (core, admin) = with_roster(&format!("plant-rollup-{name}"), &case).await;
        for device in case["devices"].as_array().expect("devices") {
            store(&core, text(&device["slug"]).parse().expect("id"), &readings(device)).await;
        }
        let window = format!("from={}&to={}", text(&case["window"]["from"]), text(&case["window"]["to"]));
        for (metric, recorded) in case["minute"].as_object().expect("minute") {
            assert_plant_minutes(
                &admin,
                &format!("{name} {metric}"),
                &format!("metric={metric}&{window}"),
                recorded,
            )
            .await;
        }
        finish(core, admin).await;
    }
}

#[tokio::test(start_paused = true)]
async fn sources_name_the_plant_members_and_every_device_as_recorded() {
    for case in oracle("plant.ndjson") {
        let name = text(&case["case"]).to_owned();
        let (core, admin) = with_roster(&format!("plant-sources-{name}"), &case).await;
        let answer = get(&admin, "/api/sources").await;
        assert_eq!((answer.status, answer.json()), (StatusCode::OK, case["sources"].clone()), "{name}");
        finish(core, admin).await;
    }
}

#[tokio::test(start_paused = true)]
async fn sources_carry_the_saved_plant_zone_and_the_default_while_none_is_saved() {
    let case = oracle("plant.ndjson").into_iter().find(|c| c["case"] == "retired-member").expect("case");
    let (core, admin) = with_roster("plant-sources-zone", &case).await;
    let zone_of = |answer: Answer| answer.json()["plant"]["timeZone"].clone();
    for zone in ["Asia/Kathmandu", "Europe/Berlin"] {
        let saved = put(&admin, "/api/settings/time-zone", &json!({"timeZone": zone})).await;
        assert_eq!(saved.status, StatusCode::OK, "{zone}");
        assert_eq!(zone_of(get(&admin, "/api/sources").await), json!(zone));
    }
    finish(core, admin).await;
    let (core, admin) = signed_in(
        Core::open_at(&dir("plant-sources-default-zone"), crate::run::Clock::wall()).await.expect("core"),
        &Config::default(),
    )
    .await;
    let default = crate::plant_zone::plant_zone(&core.store).await.expect("zone");
    assert_eq!(zone_of(get(&admin, "/api/sources").await), json!(default.iana_name().expect("named")));
    finish(core, admin).await;
}

#[tokio::test(start_paused = true)]
async fn sources_answer_any_session_and_a_stranger_only_with_the_kiosk_view_on() {
    let case = oracle("plant.ndjson").into_iter().find(|c| c["case"] == "retired-member").expect("case");
    let (core, admin) = with_roster("plant-sources-gate", &case).await;
    let user = plain_user(&admin).await;
    assert_eq!(get(&user, "/api/sources").await.json(), case["sources"]);
    for on in [false, true] {
        assert_eq!(put(&admin, "/api/settings/kiosk", &json!({"enabled": on})).await.status, StatusCode::OK);
        let stranger = get(&admin.anonymous(), "/api/sources").await;
        let want = if on {
            (StatusCode::OK, case["sources"].clone())
        } else {
            (StatusCode::UNAUTHORIZED, json!({"error": "Not signed in"}))
        };
        assert_eq!((stranger.status, stranger.json()), want, "kiosk on: {on}");
    }
    drop(user);
    finish(core, admin).await;
}

#[tokio::test(start_paused = true)]
async fn a_stranger_reads_the_plant_under_the_kiosk_view_as_a_session_does_within_its_cap() {
    let case =
        oracle("plant-rollups.ndjson").into_iter().find(|c| c["case"] == "retired-member").expect("case");
    let (core, admin) = with_roster("plant-kiosk", &case).await;
    for device in case["devices"].as_array().expect("devices") {
        store(&core, text(&device["slug"]).parse().expect("id"), &readings(device)).await;
    }
    let window = format!("from={}&to={}", text(&case["window"]["from"]), text(&case["window"]["to"]));
    let read = format!("/api/history/rollup?metric=dc.total_power&bucket=minute&source=plant&{window}");
    let stranger = admin.anonymous();
    assert_eq!(get(&stranger, &read).await.status, StatusCode::UNAUTHORIZED, "kiosk off");
    assert_eq!(put(&admin, "/api/settings/kiosk", &json!({"enabled": true})).await.status, StatusCode::OK);
    let answer = get(&stranger, &read).await;
    assert_eq!((answer.status, answer.json()), (StatusCode::OK, get(&admin, &read).await.json()));
    let capped = get(&stranger, &format!("{read}&limit=12001")).await;
    assert_eq!(
        (capped.status, capped.json()),
        (StatusCode::BAD_REQUEST, json!({"error": "limit must be 1–12000 without a session"}))
    );
    let recent = get(&stranger, "/api/history/recent?source=plant").await;
    assert_eq!(
        (recent.status, recent.json()),
        (StatusCode::OK, get(&admin, "/api/history/recent?source=plant").await.json())
    );
    finish(core, admin).await;
}

#[tokio::test(start_paused = true)]
async fn a_plant_rollup_holds_its_limit_across_members_for_a_session_and_a_kiosk_stranger() {
    let case =
        oracle("plant-rollups.ndjson").into_iter().find(|c| c["case"] == "overlapping-roles").expect("case");
    let (core, admin) = with_roster("plant-limit", &case).await;
    for device in case["devices"].as_array().expect("devices") {
        store(&core, text(&device["slug"]).parse().expect("id"), &readings(device)).await;
    }
    let golden = case["minute"]["dc.total_power"].as_array().expect("buckets");
    assert!(golden.len() > 3, "the members' buckets outnumber the limit");
    let window = format!("from={}&to={}", text(&case["window"]["from"]), text(&case["window"]["to"]));
    let read =
        format!("/api/history/rollup?metric=dc.total_power&bucket=minute&source=plant&{window}&limit=3");
    assert_eq!(put(&admin, "/api/settings/kiosk", &json!({"enabled": true})).await.status, StatusCode::OK);
    for (who, api) in [("admin", &admin), ("stranger", &admin.anonymous())] {
        let answer = get(api, &read).await;
        assert_eq!(answer.status, StatusCode::OK, "{who}");
        assert_eq!(as_floats(&answer.json()), as_floats(&json!(golden[..3])), "{who}");
    }
    finish(core, admin).await;
}

#[tokio::test(start_paused = true)]
async fn a_meter_first_in_the_roster_does_not_decide_how_the_plant_folds() {
    let device = |slug: &str, profile: &str, role: &str| {
        json!({
            "slug": slug, "name": slug, "profileId": profile, "role": role, "retiredAt": null,
        })
    };
    let roster = json!({
        "devices": [
            device("1", "acme-meter", "meter"),
            device("2", PROFILE, "inverter"),
            device("3", PROFILE, "inverter"),
        ],
        "roles": {"dc.total_power": "pv.total.power"},
    });
    let (core, admin) = with_roster("plant-meter-first", &roster).await;
    let at = NOW - 120_000;
    store(&core, 2, &[(at, "dc.total_power".into(), 100.0)]).await;
    store(&core, 3, &[(at, "dc.total_power".into(), 50.0)]).await;
    let answer = get(&admin, "/api/history/rollup?metric=dc.total_power&bucket=minute&source=plant").await;
    assert_eq!(
        (answer.status, answer.json()),
        (
            StatusCode::OK,
            json!([{"time": "2026-03-01T00:00:00.000Z", "avg": 150.0, "max": 150.0, "min": 150.0}])
        )
    );
    finish(core, admin).await;
}
