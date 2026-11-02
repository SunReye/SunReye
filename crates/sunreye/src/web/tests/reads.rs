//! The two reads the live dashboard makes on first paint: the profile manifest and the recent window.

use super::*;
use crate::samples::{MINUTE_MS, Sample, minute_of};
use crate::store::{NewConnection, NewDevice};

/// 2026-03-01T00:02:30Z: the window of 300 s opens at 23:57:30 the day before.
const NOW: i64 = 1_772_323_350_000;
const MIDNIGHT: i64 = 1_772_323_200_000;

fn oracle(file: &str) -> Vec<Value> {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/oracle").join(file);
    let text = std::fs::read_to_string(path).expect("corpus");
    text.lines().map(|line| serde_json::from_str(line).expect("json")).collect()
}

/// A signed-in account that is not an admin.
async fn plain_user(admin: &Api) -> Api {
    let body =
        json!({"email": "user@example.org", "name": "User", "password": ADMIN_PASSWORD, "admin": false});
    assert_eq!(post(admin, "/api/admin/users", &body).await.status, StatusCode::OK);
    let signed_in = login(&admin.anonymous(), "user@example.org", ADMIN_PASSWORD, false).await;
    admin.with_cookie(&signed_in.session_cookie())
}

fn fixed_clock() -> i64 {
    NOW
}

/// A core whose clock stands at [`NOW`], with one stored device and its readings.
async fn clocked(name: &str, minutes: &[(i64, Vec<Sample>)]) -> (Arc<Core>, Api) {
    let core = Core::open_at(&dir(name), fixed_clock).await.expect("core");
    let connection = NewConnection {
        transport: crate::modbus::Transport::Tcp,
        host: "10.0.0.5".into(),
        port: 502,
        logger_serial: None,
    };
    let connection = core.store.add_connection(&connection).await.expect("connection");
    let device = NewDevice { connection_id: connection, profile_id: PROFILE.into(), unit_id: 1 };
    let device = core.store.add_device(&device).await.expect("device");
    for (minute, samples) in minutes {
        let closed = crate::samples::ClosedMinute { minute: *minute, samples: samples.clone() };
        core.store.append_minute(device, &closed).await.expect("append");
    }
    signed_in(core, &Config::default()).await
}

fn pv(at_ms: i64, value: f64) -> Sample {
    Sample { at_ms, values: vec![("pv".to_owned(), value)] }
}

fn reading(at_ms: i64, key: &str, value: f64) -> (i64, Vec<Sample>) {
    let sample = Sample { at_ms, values: vec![(key.to_owned(), value)] };
    (minute_of(at_ms), vec![sample])
}

#[tokio::test]
async fn both_reads_refuse_a_stranger_and_answer_a_plain_user() {
    let (core, admin) = open(&dir("reads-gate")).await;
    put(&admin, "/api/settings/active-profile", &json!({"id": PROFILE})).await;
    let user = plain_user(&admin).await;
    for path in ["/api/profile", "/api/history/recent"] {
        let stranger = get(&admin.anonymous(), path).await;
        assert_eq!(
            (stranger.status, stranger.json()),
            (StatusCode::UNAUTHORIZED, json!({"error": "Not signed in"})),
            "{path}"
        );
        assert_eq!(get(&user, path).await.status, StatusCode::OK, "{path}");
        assert_eq!(get(&admin, path).await.status, StatusCode::OK, "{path}");
    }
    drop(admin);
    core.stop().await;
}

#[tokio::test]
async fn the_manifest_is_absent_until_a_profile_is_chosen() {
    let (core, admin) = open(&dir("manifest-none")).await;
    let answer = get(&admin, "/api/profile").await;
    assert_eq!(
        (answer.status, answer.json()),
        (StatusCode::NOT_FOUND, json!({"error": "No active profile"}))
    );
    drop(admin);
    core.stop().await;
}

#[tokio::test]
async fn the_manifest_is_the_chosen_profiles_as_the_2x_engine_answers_it() {
    let (core, admin) = open(&dir("manifest")).await;
    put(&admin, "/api/settings/active-profile", &json!({"id": PROFILE})).await;
    let answer = get(&admin, "/api/profile").await;
    assert_eq!(answer.status, StatusCode::OK);
    let body = answer.json();
    let rows = oracle("profile-manifest.ndjson");
    let want = &rows.iter().find(|row| row["profile"]["id"] == PROFILE).expect("oracle row")["manifest"];
    assert_eq!(
        (&body["id"], &body["name"], &body["manufacturer"]),
        (&want["id"], &want["name"], &want["manufacturer"])
    );
    assert_eq!(body["capabilities"], want["capabilities"]);
    let summary = |manifest: &Value| -> Vec<Value> {
        let metrics = manifest["metrics"].as_array().expect("metrics");
        metrics
            .iter()
            .map(|m| json!([m["key"], m["topic"], m["kind"], m["storage"], m["writable"]]))
            .collect()
    };
    assert_eq!(summary(&body), summary(want));
    drop(admin);
    core.stop().await;
}

#[tokio::test]
async fn a_profile_from_a_source_is_served_like_a_compiled_in_one() {
    let ca = Ca::new("test root");
    let port = serve_repo(&ca, &[third_party("acme-hybrid", PROFILE)]).await;
    let (core, admin) = open_trusting(&dir("manifest-source"), &ca).await;
    post(&admin, "/api/settings/profile-sources", &source_body(port)).await;
    put(&admin, "/api/settings/active-profile", &json!({"id": "acme-hybrid"})).await;
    let body = get(&admin, "/api/profile").await.json();
    assert_eq!((&body["id"], &body["name"]), (&json!("acme-hybrid"), &json!("Acme Hybrid")));
    assert!(body["metrics"].as_array().is_some_and(|m| !m.is_empty()));
    drop(admin);
    core.stop().await;
}

#[tokio::test]
async fn an_empty_store_answers_a_finite_origin_and_no_metrics() {
    let (core, admin) = open(&dir("recent-empty")).await;
    let answer = get(&admin, "/api/history/recent").await;
    assert_eq!(answer.status, StatusCode::OK);
    assert_eq!(answer.json(), json!({"t0": 0, "step": 1, "metrics": {}}));
    let wide = get(&admin, "/api/history/recent?seconds=3600&stepSeconds=60&source=plant&inverterId=x").await;
    assert_eq!(wide.json(), json!({"t0": 0, "step": 60, "metrics": {}}));
    drop(admin);
    core.stop().await;
}

#[tokio::test]
async fn a_window_outside_what_the_dashboard_may_ask_is_a_400_in_the_error_shape() {
    let (core, admin) = open(&dir("recent-refused")).await;
    for query in [
        "seconds=0",
        "seconds=3601",
        "stepSeconds=0",
        "stepSeconds=61",
        "seconds=-1",
        "seconds=soon",
        "stepSeconds=1.5",
    ] {
        let answer = get(&admin, &format!("/api/history/recent?{query}")).await;
        assert_eq!(answer.status, StatusCode::BAD_REQUEST, "{query}");
        assert!(answer.json()["error"].as_str().is_some_and(|e| !e.is_empty()), "{query}");
    }
    for query in ["seconds=1", "seconds=3600", "stepSeconds=1", "stepSeconds=60"] {
        let answer = get(&admin, &format!("/api/history/recent?{query}")).await;
        assert_eq!(answer.status, StatusCode::OK, "{query}");
    }
    drop(admin);
    core.stop().await;
}

#[tokio::test]
async fn polled_simulator_readings_come_back_as_the_compact_series() {
    let (sim, case) = simulator().await;
    let dir = dir("recent-simulator");
    let (core, admin) = open(&dir).await;
    put(&admin, "/api/settings/active-profile", &json!({"id": PROFILE})).await;
    put(&admin, "/api/settings/inverter", &connection(sim.addr.port())).await;
    wait_until_polled(&sim).await;
    drop(admin);
    core.stop().await;

    let (core, admin) = open(&dir).await;
    let before = std::time::SystemTime::now();
    let answer = get(&admin, "/api/history/recent?seconds=300&stepSeconds=1").await;
    assert_eq!(answer.status, StatusCode::OK);
    let body = answer.json();
    assert_eq!(body["step"], 1);
    let t0 = body["t0"].as_i64().expect("t0");
    let now =
        i64::try_from(before.duration_since(std::time::UNIX_EPOCH).expect("epoch").as_millis()).expect("ms");
    assert!((now - 301_000..=now).contains(&t0), "t0 {t0} is inside the window");
    let metrics = body["metrics"].as_object().expect("metrics");
    assert_eq!(metrics.len(), case.readings.len());
    for (key, want) in &case.readings {
        let series = &metrics[key];
        let (offsets, values) = (series["o"].as_array().expect("o"), series["v"].as_array().expect("v"));
        assert_eq!(offsets.len(), values.len(), "{key}");
        assert_eq!(offsets[0], 0, "{key}: every metric was read in the first poll");
        assert!(values.iter().all(|v| v.as_f64() == Some(*want)), "{key}: {values:?} vs {want}");
        assert!(offsets.windows(2).all(|w| w[0].as_u64() < w[1].as_u64()), "{key}: offsets ascend");
    }
    drop(admin);
    core.stop().await;
}

#[tokio::test]
async fn a_window_across_midnight_answers_one_run_of_offsets() {
    let readings = [
        reading(MIDNIGHT - 10_000, "pv", 100.0),
        reading(MIDNIGHT, "pv", 200.0),
        reading(MIDNIGHT + 999, "pv", 300.0),
        reading(NOW, "pv", -50.0),
        reading(NOW - 90_000, "load", 0.0),
    ];
    let mut minutes: Vec<(i64, Vec<Sample>)> = Vec::new();
    for (minute, samples) in readings {
        match minutes.iter_mut().find(|(m, _)| *m == minute) {
            Some((_, held)) => held.extend(samples),
            None => minutes.push((minute, samples)),
        }
    }
    let (core, admin) = clocked("recent-midnight", &minutes).await;
    let answer = get(&admin, "/api/history/recent?seconds=300&stepSeconds=1").await;
    assert_eq!(answer.status, StatusCode::OK);
    assert_eq!(
        answer.json(),
        json!({
            "t0": 1_772_323_190_000_i64, "step": 1,
            "metrics": {
                "load": {"o": [70], "v": [0.0]},
                "pv": {"o": [0, 10, 160], "v": [100.0, 300.0, -50.0]}
            }
        })
    );
    let narrow = get(&admin, "/api/history/recent?seconds=60&stepSeconds=60").await.json();
    assert_eq!(
        narrow,
        json!({
            "t0": 1_772_323_260_000_i64, "step": 60,
            "metrics": {"load": {"o": [0], "v": [0.0]}, "pv": {"o": [0, 1], "v": [300.0, -50.0]}}
        }),
        "each metric opens the window with the newest reading before it"
    );
    drop(admin);
    core.stop().await;
}

#[tokio::test]
async fn the_open_minute_is_served_before_it_is_stored() {
    let minute_start = minute_of(NOW) * MINUTE_MS;
    let (core, admin) = clocked("recent-open", &[reading(minute_start - 5_000, "pv", 1.0)]).await;
    let device = core.store.devices().await.expect("devices")[0].id;
    for (at_ms, value) in [(minute_start + 2_000, 2.0), (NOW - 1_000, 3.0)] {
        assert!(core.unstored.push(device, pv(at_ms, value)).is_none());
    }
    let answer = get(&admin, "/api/history/recent?seconds=60&stepSeconds=1").await;
    assert_eq!(
        answer.json(),
        json!({
            "t0": NOW - 35_000, "step": 1,
            "metrics": {"pv": {"o": [0, 7, 34], "v": [1.0, 2.0, 3.0]}}
        }),
        "the minute the poll loop holds answers beside the stored one"
    );
    drop(admin);
    core.stop().await;
}

#[tokio::test]
#[expect(clippy::await_holding_lock, reason = "the held lock stops the read between its two steps")]
async fn a_minute_written_and_released_while_the_window_is_read_is_served() {
    let minute_start = minute_of(NOW) * MINUTE_MS;
    let (core, admin) = clocked("recent-race", &[]).await;
    let device = core.store.devices().await.expect("devices")[0].id;
    assert!(core.unstored.push(device, pv(minute_start - 5_000, 1.0)).is_none());
    let closed = core.unstored.push(device, pv(NOW - 1_000, 3.0)).expect("a closed minute");

    let mut held = core.unstored.locked();
    let before = core.unstored.lock_requests();
    // Its own thread blocks on the held lock while the test writes; worker threads hand back the store's
    // connection the read let go of.
    let request = std::thread::spawn(move || {
        let runtime = tokio::runtime::Builder::new_multi_thread().enable_all().build().expect("runtime");
        runtime.block_on(get(&admin, "/api/history/recent?seconds=60&stepSeconds=1"))
    });
    let deadline = Instant::now() + Duration::from_secs(20);
    while core.unstored.lock_requests() == before {
        assert!(Instant::now() < deadline, "the request never asked for the held readings");
        tokio::task::yield_now().await;
    }
    core.store.append_minute(device, &closed).await.expect("append");
    held.get_mut(&device).expect("held").retain(|s| minute_of(s.at_ms) != closed.minute);
    drop(held);

    // Joined off this thread, so it can hand the store's connection back meanwhile.
    assert_eq!(
        tokio::task::spawn_blocking(|| request.join()).await.expect("join").expect("request").json(),
        json!({"t0": NOW - 35_000, "step": 1, "metrics": {"pv": {"o": [0, 34], "v": [1.0, 3.0]}}}),
        "the closed minute is in the store or the held readings, never neither"
    );
    core.stop().await;
}

#[tokio::test]
async fn a_window_with_no_query_reaches_back_300_seconds() {
    let readings = [
        reading(NOW - 301_000, "pv", 1.0),
        reading(NOW - 299_000, "pv", 2.0),
        reading(NOW - 10_000, "pv", 3.0),
    ];
    let minutes: Vec<_> = readings.into_iter().collect();
    let (core, admin) = clocked("recent-default", &minutes).await;
    let answer = get(&admin, "/api/history/recent").await;
    assert_eq!(answer.status, StatusCode::OK);
    assert_eq!(
        answer.json(),
        json!({
            "t0": NOW - 300_000, "step": 1,
            "metrics": {"pv": {"o": [0, 1, 290], "v": [1.0, 2.0, 3.0]}}
        }),
        "the window opens at 300 s: the reading 301 s back seeds it, the one 299 s back is in it"
    );
    drop(admin);
    core.stop().await;
}
