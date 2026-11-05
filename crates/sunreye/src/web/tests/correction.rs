//! The forecast correction: the learn run against seeded hourly rollups and a stand-in reanalysis archive,
//! the factor applied to the forecast, and its view. Expected cells come from the model and the fold, both
//! held to the 3.x oracle.

use std::collections::BTreeSet;
use std::sync::atomic::Ordering;

use jiff::civil::date;
use jiff::tz::TimeZone;

use super::forecast::{FRESH, LAT, LON, configure, corrected, fixed_now, forecasting, model};
use super::*;
use crate::forecast::{
    self, CorrectionCell, CorrectionModel, Irradiance, Location, Observation, Run, SimInputs, Skill, Variant,
};
use crate::learn::{LearnState, Outcome, learn_once};
use crate::samples::{ClosedMinute, Sample};

/// 2026-07-23T10:00:00Z: 2026-07-20 is the last settled day.
const LEARN_NOW_MS: i64 = 1_784_800_800_000;
/// 2026-07-19T22:00:00Z, plant-local midnight of 2026-07-20 in Berlin.
const DAY_START_S: i64 = 1_784_498_400;
/// Plane irradiance over the plant-local day, hour by hour.
const GTI: [f64; 24] = [
    0.0, 0.0, 0.0, 0.0, 0.0, 5.0, 40.0, 120.0, 250.0, 390.0, 520.0, 620.0, 690.0, 720.0, 700.0, 640.0, 540.0,
    410.0, 270.0, 140.0, 45.0, 5.0, 0.0, 0.0,
];
const MEASURED_W: f64 = 3000.0;

fn learn_now() -> i64 {
    LEARN_NOW_MS
}

fn hours() -> impl Iterator<Item = i64> {
    (0..24).map(|h| DAY_START_S + h * 3600)
}

pub(super) fn archive_payload() -> Value {
    let temperature = vec![20.0; 24];
    json!({
        "utc_offset_seconds": 7200, "timezone": "Europe/Berlin",
        "hourly": {"time": hours().collect::<Vec<_>>(), "temperature_2m": temperature, "global_tilted_irradiance_instant": GTI}
    })
}

/// The archive as the model reads it: UTC labels.
fn archive() -> Irradiance {
    let label =
        |s: i64| jiff::Timestamp::from_second(s).expect("instant").strftime("%Y-%m-%dT%H:%M").to_string();
    Irradiance {
        times: hours().map(label).collect(),
        utc_offset_seconds: 0,
        location: Location { latitude: LAT, longitude: LON },
        temperature: vec![20.0; 24],
        gti: vec![GTI.to_vec()],
        dni: None,
        wind_speed: None,
    }
}

/// `MEASURED_W` every minute from 09:00Z to 12:59Z on 2026-07-20: plant-local 11:00 to 14:59.
async fn seed_measured(core: &Core) {
    let profile = core.profile(PROFILE).await.expect("profile").expect("known profile");
    let key =
        profile.metrics.iter().find(|m| m.role.as_deref() == Some("pv.total.power")).expect("pv").key.clone();
    let from_ms = (DAY_START_S + 11 * 3600) * 1000;
    for minute in 0..240 {
        let at_ms = from_ms + minute * 60_000;
        let sample = Sample { at_ms, values: vec![(key.clone(), MEASURED_W)] };
        let closed = ClosedMinute { minute: crate::samples::minute_of(at_ms), samples: vec![sample] };
        core.store.append_minute(1, &closed).await.expect("append");
    }
}

/// What learning the seeded hours folds in Berlin, where they start at 11:00.
fn learned() -> (CorrectionModel, LearnState) {
    learned_at([11, 12, 13, 14])
}

/// What learning the seeded hours folds: the model's watts for each UTC hour against the measured average,
/// in the plant-local `hours` they start in.
fn learned_at(hours: [i8; 4]) -> (CorrectionModel, LearnState) {
    let run = Run { time_zone: &TimeZone::UTC, now_ms: 0, sim: SimInputs::default(), correction: None };
    let series = forecast::build(&model(None), &archive(), "open-meteo", &run).expect("model").raw.series;
    let observations: Vec<Observation> = hours
        .into_iter()
        .zip(11..15)
        .map(|(hour, slot)| Observation {
            month: 7,
            hour,
            expected_w: series[slot].watts,
            actual_w: MEASURED_W,
        })
        .collect();
    let mut model = CorrectionModel::default();
    let fold = model.learn(Skill::default(), &observations, 6400.0, None);
    assert_eq!(fold.touched.len(), 4, "every seeded hour is fit to learn from");
    (model, LearnState { learned_through: date(2026, 7, 20), skill: fold.skill })
}

#[tokio::test]
async fn a_learn_run_folds_the_measured_hours_and_a_second_run_for_the_day_is_a_no_op() {
    let (core, admin, standin) = forecasting("correction-learn", learn_now).await;
    configure(&admin, None).await;
    seed_measured(&core).await;
    assert_eq!(
        learn_once(&core).await.expect("learn"),
        Outcome::Learned { hours: 4, through: date(2026, 7, 20) }
    );
    let (model, state) = learned();
    assert_eq!(core.store.correction(1).await.expect("read"), (model.clone(), Some(state)));
    let path = standin.paths.lock().expect("paths")[0].clone();
    assert!(
        path.starts_with("/v1/archive?") && path.contains("start_date=2026-04-21&end_date=2026-07-20"),
        "{path}"
    );

    assert_eq!(learn_once(&core).await.expect("learn"), Outcome::UpToDate);
    assert_eq!(standin.hits.load(Ordering::SeqCst), 1, "nothing due: no fetch");
    assert_eq!(core.store.correction(1).await.expect("read"), (model, Some(state)));
    drop(admin);
    core.stop().await;
}

#[tokio::test]
async fn a_learn_run_cuts_hours_in_the_saved_plant_zone_not_the_zone_the_archive_names() {
    // The archive names Europe/Berlin; the seeded hours are 09:00Z to 12:59Z.
    for (saved, name, hours) in [
        ("Asia/Kolkata", "Asia/Kolkata", [14, 15, 16, 17]),
        ("Asia/Kathmandu", "Asia/Kathmandu", [14, 15, 16, 17]),
        ("UTC", "UTC", [9, 10, 11, 12]),
        ("Gone/Zone", "UTC", [9, 10, 11, 12]),
    ] {
        let (core, admin, standin) =
            forecasting(&format!("correction-zone-{}", saved.replace('/', "-")), learn_now).await;
        configure(&admin, None).await;
        core.store.save_plant_time_zone(saved).await.expect("zone");
        seed_measured(&core).await;
        assert_eq!(
            learn_once(&core).await.expect("learn"),
            Outcome::Learned { hours: 4, through: date(2026, 7, 20) },
            "{saved}"
        );
        let (model, state) = learned_at(hours);
        assert_eq!(core.store.correction(1).await.expect("read"), (model, Some(state)), "{saved}");
        let path = standin.paths.lock().expect("paths")[0].clone();
        let url = reqwest::Url::parse(&format!("http://archive{path}")).expect("path");
        let zone = url.query_pairs().find(|(k, _)| k == "timezone").map(|(_, v)| v.into_owned());
        assert_eq!(zone.as_deref(), Some(name), "{saved}: {path}");
        drop(admin);
        core.stop().await;
    }
}

#[tokio::test]
async fn a_failed_archive_fetch_leaves_the_stored_model_untouched() {
    let (core, admin, standin) = forecasting("correction-fetch-failed", learn_now).await;
    configure(&admin, None).await;
    seed_measured(&core).await;
    let mut stored = CorrectionModel::default();
    stored.set(7, 12, CorrectionCell { ratio: 0.9, weight: 3.0 });
    let state = LearnState {
        learned_through: date(2026, 7, 18),
        skill: Skill { mae_raw: 1.0, mae_corrected: 1.0, samples: 3.0 },
    };
    core.store.save_correction(1, &stored, &BTreeSet::from([(7, 12)]), &state).await.expect("save");
    standin.failing.store(true, Ordering::SeqCst);
    assert_eq!(learn_once(&core).await.expect("learn"), Outcome::FetchFailed);
    assert_eq!(core.store.correction(1).await.expect("read"), (stored, Some(state)));
    let path = standin.paths.lock().expect("paths")[0].clone();
    assert!(path.contains("start_date=2026-07-19&end_date=2026-07-20"), "{path}");
    drop(admin);
    core.stop().await;
}

#[tokio::test]
async fn a_window_without_measured_hours_keeps_the_cursor_so_the_days_are_retried() {
    let (core, admin, standin) = forecasting("correction-no-history", learn_now).await;
    configure(&admin, None).await;
    assert_eq!(learn_once(&core).await.expect("learn"), Outcome::NoMeasuredHours);
    assert_eq!(core.store.correction(1).await.expect("read"), (CorrectionModel::default(), None));
    assert_eq!(standin.hits.load(Ordering::SeqCst), 1);
    drop(admin);
    core.stop().await;
}

#[tokio::test]
async fn an_unconfigured_forecast_learns_nothing_and_fetches_nothing() {
    let (core, admin, standin) = forecasting("correction-unconfigured", learn_now).await;
    seed_measured(&core).await;
    assert_eq!(learn_once(&core).await.expect("learn"), Outcome::Idle);
    assert_eq!(standin.hits.load(Ordering::SeqCst), 0);
    drop(admin);
    core.stop().await;
}

/// A learned grid over the stand-in forecast's plant-local hours, 11:00 to 12:59 on a July day.
fn stored_grid() -> CorrectionModel {
    let mut model = CorrectionModel::default();
    model.set(7, 11, CorrectionCell { ratio: 1.3, weight: 5.0 });
    model.set(7, 12, CorrectionCell { ratio: 0.5, weight: 30.0 });
    model
}

#[tokio::test]
async fn the_forecast_carries_the_learned_factor_only_while_the_correction_is_enabled() {
    let (core, admin, _) = forecasting("correction-applied", fixed_now).await;
    configure(&admin, None).await;
    let state = LearnState { learned_through: date(2026, 7, 20), skill: Skill::default() };
    core.store
        .save_correction(1, &stored_grid(), &BTreeSet::from([(7, 11), (7, 12)]), &state)
        .await
        .expect("save");
    let plain = corrected(&model(None), SimInputs::default(), Variant::Raw, &FRESH, None);
    assert_eq!(get(&admin, "/api/forecast").await.json(), plain, "disabled: not applied");

    let on = json!({"forecast": {"correction": {"enabled": true}}});
    assert_eq!(put(&admin, "/api/settings/weather", &on).await.status, StatusCode::OK);
    let applied = corrected(&model(None), SimInputs::default(), Variant::Raw, &FRESH, Some(&stored_grid()));
    assert_ne!(applied, plain);
    assert_eq!(get(&admin, "/api/forecast").await.json(), applied);
    drop(admin);
    core.stop().await;
}

#[tokio::test]
async fn the_correction_view_names_the_applied_factors_and_the_skill() {
    let (core, admin, _) = forecasting("correction-view", fixed_now).await;
    let empty = json!({"enabled": false, "learnedThrough": null,
        "skill": {"maeRaw": 0.0, "maeCorrected": 0.0, "improvementPct": 0.0, "samples": 0.0}, "cells": []});
    assert_eq!(get(&admin, "/api/forecast/correction").await.json(), empty);

    let mut grid = CorrectionModel::default();
    grid.set(7, 13, CorrectionCell { ratio: 1.3, weight: 5.0 });
    grid.set(12, 0, CorrectionCell { ratio: 0.2, weight: 30.0 });
    let skill = Skill { mae_raw: 400.0, mae_corrected: 300.0, samples: 12.0 };
    let state = LearnState { learned_through: date(2026, 7, 20), skill };
    core.store.save_correction(1, &grid, &BTreeSet::from([(7, 13), (12, 0)]), &state).await.expect("save");
    let on = json!({"forecast": {"correction": {"enabled": true}}});
    assert_eq!(put(&admin, "/api/settings/weather", &on).await.status, StatusCode::OK);
    assert_eq!(
        get(&admin, "/api/forecast/correction").await.json(),
        json!({"enabled": true, "learnedThrough": "2026-07-20",
            "skill": {"maeRaw": 400.0, "maeCorrected": 300.0, "improvementPct": 25.0, "samples": 12.0},
            "cells": [{"month": 7, "hour": 13, "factor": 1.15, "weight": 5.0},
                {"month": 12, "hour": 0, "factor": 0.6, "weight": 30.0}]})
    );
    assert_eq!(get(&admin.anonymous(), "/api/forecast/correction").await.status, StatusCode::UNAUTHORIZED);
    drop(admin);
    core.stop().await;
}

#[test]
fn the_learn_clock_is_three_days_after_the_seeded_day() {
    assert_eq!(
        jiff::Timestamp::from_millisecond(LEARN_NOW_MS).expect("now").to_string(),
        "2026-07-23T10:00:00Z"
    );
    assert_eq!(jiff::Timestamp::from_second(DAY_START_S).expect("start").to_string(), "2026-07-19T22:00:00Z");
}
