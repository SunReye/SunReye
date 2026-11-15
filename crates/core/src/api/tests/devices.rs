//! Connections and devices (ADR 6): stable ids, secrets never read back, and every change in the
//! change log (ADR 19).

use std::collections::{BTreeSet, HashMap};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use axum::body::Body;
use axum::http::{Request, StatusCode, header};
use serde_json::{Value, json};

use super::{Core, HOME, from, get, json, problem, with_cookie};
use crate::bus::DeviceId;
use crate::transport::fake;

fn id(value: &Value) -> u32 {
    u32::try_from(value.as_u64().unwrap()).unwrap()
}

pub(super) fn send(method: &str, uri: &str, body: &Value) -> Request<Body> {
    let request = Request::builder()
        .method(method)
        .uri(uri)
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(body.to_string()))
        .unwrap();
    from(HOME, request)
}

pub(super) fn delete(uri: &str) -> Request<Body> {
    from(HOME, Request::delete(uri).body(Body::empty()).unwrap())
}

/// The owner's gateway, at an address nothing listens on.
pub(super) fn gateway() -> Value {
    json!({ "name": "gateway", "transport": "modbus-tcp", "host": "127.0.0.1", "port": 9 })
}

impl Core {
    pub(super) async fn ask(
        &self,
        set_cookie: &str,
        request: Request<Body>,
    ) -> (StatusCode, Value) {
        let response = self.send(with_cookie(set_cookie, request)).await;
        let status = response.status();
        if status == StatusCode::NO_CONTENT {
            return (status, Value::Null);
        }
        (status, json(response).await)
    }

    /// Adds `connection`; returns its id.
    pub(super) async fn connection(&self, set_cookie: &str, connection: &Value) -> Value {
        let (status, body) = self
            .ask(set_cookie, send("POST", "/api/v1/connections", connection))
            .await;
        assert_eq!(status, StatusCode::CREATED, "{body}");
        body["id"].clone()
    }

    /// Adds the owner's Deye at `unit` behind `connection`; returns its id.
    pub(super) async fn deye(&self, set_cookie: &str, connection: &Value, unit: u8) -> Value {
        let device = json!({
            "name": "Deye", "connection": connection, "profile": "deye-sg05lp3", "unit": unit,
        });
        let (status, body) = self
            .ask(set_cookie, send("POST", "/api/v1/devices", &device))
            .await;
        assert_eq!(status, StatusCode::CREATED, "{body}");
        body["id"].clone()
    }
}

#[tokio::test]
async fn a_connections_secrets_are_set_by_name_and_never_read_back() {
    let dir = tempfile::tempdir().unwrap();
    let (core, set_cookie) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    let mut connection = gateway();
    connection["secrets"] = json!({ "unlock": "4711", "password": "hunter2" });
    let id = core.connection(&set_cookie, &connection).await;

    let (_, listed) = core.ask(&set_cookie, get("/api/v1/connections")).await;
    assert_eq!(
        listed,
        json!({ "connections": [{
            "id": id, "name": "gateway", "transport": "modbus-tcp", "host": "127.0.0.1",
            "port": 9, "pollSeconds": 5, "secrets": ["password", "unlock"],
        }] })
    );

    // A secret given a value is set, `null` removes it, an absent one is kept.
    let mut change = gateway();
    change["secrets"] = json!({ "password": null, "token": "abc" });
    let (status, changed) = core
        .ask(
            &set_cookie,
            send("PUT", &format!("/api/v1/connections/{id}"), &change),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(changed["secrets"], json!(["token", "unlock"]));
    for text in [listed.to_string(), changed.to_string()] {
        assert!(!text.contains("4711") && !text.contains("hunter2") && !text.contains("abc"));
    }
}

#[tokio::test]
async fn devices_keep_their_ids_and_a_removed_id_is_never_reused() {
    let dir = tempfile::tempdir().unwrap();
    let (core, set_cookie) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    let connection = core.connection(&set_cookie, &gateway()).await;
    let first = core.deye(&set_cookie, &connection, 0).await;
    let second = core.deye(&set_cookie, &connection, 1).await;

    let moved = json!({
        "name": "Roof", "connection": connection, "profile": "deye-sg05lp3", "unit": 2,
    });
    let (status, body) = core
        .ask(
            &set_cookie,
            send("PUT", &format!("/api/v1/devices/{first}"), &moved),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["id"], first);
    let (status, _) = core
        .ask(&set_cookie, delete(&format!("/api/v1/devices/{second}")))
        .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let third = core.deye(&set_cookie, &connection, 1).await;

    assert_ne!(third, first);
    assert_ne!(third, second);
    let (_, listed) = core.ask(&set_cookie, get("/api/v1/devices")).await;
    let mut roof = moved;
    roof["id"] = first;
    roof["writes"] = json!(false);
    assert_eq!(listed["devices"][0], roof);
    assert_eq!(listed["devices"][1]["id"], third);
}

fn deye(connection: &Value, profile: &str, unit: u8) -> Value {
    json!({ "name": "Deye", "connection": connection, "profile": profile, "unit": unit })
}

fn unprocessable(code: &str) -> (StatusCode, String) {
    (StatusCode::UNPROCESSABLE_ENTITY, code.to_owned())
}

fn conflict(code: &str) -> (StatusCode, String) {
    (StatusCode::CONFLICT, code.to_owned())
}

impl Core {
    /// The status and problem code of a refused request.
    async fn refused(&self, set_cookie: &str, request: Request<Body>) -> (StatusCode, String) {
        problem(self.send(with_cookie(set_cookie, request)).await).await
    }
}

#[tokio::test]
async fn a_device_names_a_known_connection_and_profile_and_a_free_unit_id() {
    let dir = tempfile::tempdir().unwrap();
    let (core, set_cookie) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    let connection = core.connection(&set_cookie, &gateway()).await;
    let device = core.deye(&set_cookie, &connection, 0).await;
    // A second connection to the same endpoint shares its unit ids.
    let again = core.connection(&set_cookie, &gateway()).await;
    let add = |body: Value| send("POST", "/api/v1/devices", &body);
    let at = format!("/api/v1/devices/{device}");

    let unknown = add(deye(&json!(42), "deye-sg05lp3", 1));
    assert_eq!(
        core.refused(&set_cookie, unknown).await,
        unprocessable("device.connection")
    );
    let profile = add(deye(&connection, "nope", 1));
    assert_eq!(
        core.refused(&set_cookie, profile).await,
        unprocessable("device.profile")
    );
    let taken = add(deye(&again, "deye-sg05lp3", 0));
    assert_eq!(
        core.refused(&set_cookie, taken).await,
        conflict("device.address")
    );
    let other = send("PUT", &at, &deye(&connection, "another", 0));
    assert_eq!(
        core.refused(&set_cookie, other).await,
        unprocessable("device.profile")
    );
    let none = send(
        "PUT",
        "/api/v1/devices/42",
        &deye(&connection, "deye-sg05lp3", 1),
    );
    assert_eq!(
        core.refused(&set_cookie, none).await,
        (StatusCode::NOT_FOUND, "device.none".to_owned())
    );
    // Moving the device to the endpoint it is on keeps its own unit id free.
    let moved = send("PUT", &at, &deye(&again, "deye-sg05lp3", 0));
    assert_eq!(core.ask(&set_cookie, moved).await.0, StatusCode::OK);
}

/// A device stores its family and the variant the scan proposed (ADR 5); the variant's limits
/// are the ones that apply, here its battery current.
#[tokio::test]
async fn a_device_stores_its_familys_variant_and_reads_with_its_limits() {
    let dir = tempfile::tempdir().unwrap();
    let (core, set_cookie) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    let connection = core.connection(&set_cookie, &gateway()).await;
    let mut small = deye(&connection, "deye-sg05lp3", 1);
    small["variant"] = json!("5k");

    let (status, added) = core
        .ask(&set_cookie, send("POST", "/api/v1/devices", &small))
        .await;

    assert_eq!(status, StatusCode::CREATED, "{added}");
    assert_eq!(added["variant"], "5k");
    let (_, listed) = core.ask(&set_cookie, get("/api/v1/devices")).await;
    assert_eq!(listed["devices"][0]["variant"], "5k");
    let (_, capabilities) = core.ask(&set_cookie, get("/api/v1/capabilities")).await;
    let settings = &capabilities["devices"][added["id"].to_string()]["settings"];
    assert_eq!(settings[0]["range"], json!({ "min": 0.0, "max": 120.0 }));

    let mut unknown = deye(&connection, "deye-sg05lp3", 2);
    unknown["variant"] = json!("99k");
    assert_eq!(
        core.refused(&set_cookie, send("POST", "/api/v1/devices", &unknown))
            .await,
        unprocessable("device.profile")
    );
    let mut other = small.clone();
    other["variant"] = json!("15k");
    let at = format!("/api/v1/devices/{}", added["id"]);
    assert_eq!(
        core.refused(&set_cookie, send("PUT", &at, &other)).await,
        conflict("device.profile-change")
    );
}

/// SunSpec's variant is the model after the common model (ADR 5), by its id.
#[tokio::test]
async fn a_sunspec_devices_variant_is_its_model() {
    let dir = tempfile::tempdir().unwrap();
    let (core, set_cookie) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    let connection = core.connection(&set_cookie, &gateway()).await;
    let mut inverter = deye(&connection, "sunspec", 1);
    inverter["variant"] = json!("103");
    let mut named = deye(&connection, "sunspec", 2);
    named["variant"] = json!("three-phase");

    let (status, added) = core
        .ask(&set_cookie, send("POST", "/api/v1/devices", &inverter))
        .await;

    assert_eq!(status, StatusCode::CREATED, "{added}");
    assert_eq!(added["variant"], "103");
    assert_eq!(
        core.refused(&set_cookie, send("POST", "/api/v1/devices", &named))
            .await,
        unprocessable("device.profile")
    );
}

#[tokio::test]
async fn a_connection_needs_a_host_and_is_removed_only_once_no_device_uses_it() {
    let dir = tempfile::tempdir().unwrap();
    let (core, set_cookie) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    let connection = core.connection(&set_cookie, &gateway()).await;
    let device = core.deye(&set_cookie, &connection, 0).await;
    let remove = || delete(&format!("/api/v1/connections/{connection}"));

    let hostless = json!({ "name": "g", "transport": "modbus-tcp", "host": "", "port": 502 });
    assert_eq!(
        core.refused(&set_cookie, send("POST", "/api/v1/connections", &hostless))
            .await,
        unprocessable("connection.value")
    );
    assert_eq!(
        core.refused(&set_cookie, remove()).await,
        conflict("connection.in-use")
    );
    core.ask(&set_cookie, delete(&format!("/api/v1/devices/{device}")))
        .await;
    assert_eq!(
        core.ask(&set_cookie, remove()).await.0,
        StatusCode::NO_CONTENT
    );
}

#[tokio::test]
async fn every_configuration_change_appends_to_the_change_log() {
    let dir = tempfile::tempdir().unwrap();
    let (core, set_cookie) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    let now = UNIX_EPOCH + Duration::from_hours(498_384);
    core.set_clock(now);
    let mut connection = gateway();
    connection["secrets"] = json!({ "unlock": "4711" });
    let id = core.connection(&set_cookie, &connection).await;
    let device = core.deye(&set_cookie, &id, 0).await;
    core.ask(&set_cookie, delete(&format!("/api/v1/devices/{device}")))
        .await;

    let (status, log) = core.ask(&set_cookie, get("/api/v1/changes")).await;

    assert_eq!(status, StatusCode::OK);
    let entry = |subject: &str, id: &Value, action: &str, state: Value| {
        json!({
            "changed": "2026-11-09T00:00:00Z", "appliesFrom": "2026-11-09T00:00:00Z",
            "actor": "admin", "subject": subject, "id": id, "action": action, "state": state,
        })
    };
    assert_eq!(
        log,
        json!({ "changes": [
            entry("connection", &id, "add", json!({
                "id": id, "name": "gateway", "transport": "modbus-tcp", "host": "127.0.0.1",
                "port": 9, "pollSeconds": 5, "secrets": ["unlock"],
            })),
            entry("device", &device, "add", json!({
                "id": device, "name": "Deye", "connection": id, "profile": "deye-sg05lp3",
                "unit": 0, "writes": false,
            })),
            entry("device", &device, "remove", Value::Null),
        ] })
    );
}

#[tokio::test]
async fn devices_behind_one_endpoint_share_one_task_and_their_readings_are_stored() {
    let dir = tempfile::tempdir().unwrap();
    let (core, set_cookie) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    let mut device = fake::serve().await;
    let mut readings = core.bus.subscribe();
    let port = device.address.port();
    let gateway = json!({ "name": "gateway", "transport": "modbus-tcp", "host": "127.0.0.1",
        "port": port });
    let stick = core.connection(&set_cookie, &gateway).await;
    // A second connection to the same endpoint still goes through its one task.
    let again = core.connection(&set_cookie, &gateway).await;
    let first = core.deye(&set_cookie, &stick, 0).await;
    let second = core.deye(&set_cookie, &again, 1).await;

    // Some connection reads both unit ids: one task polls both devices.
    let mut units: HashMap<usize, BTreeSet<u8>> = HashMap::new();
    let both = BTreeSet::from([0, 1]);
    tokio::time::timeout(Duration::from_secs(20), async {
        let mut done = false;
        while !done {
            let read = device.reads.recv().await.unwrap();
            let seen = units.entry(read.connection).or_default();
            seen.insert(read.unit);
            done = *seen == both;
        }
    })
    .await
    .unwrap();
    let mut polled = BTreeSet::new();
    while polled.len() < 2 {
        polled.insert(readings.recv().await.unwrap().device.0);
    }
    assert_eq!(polled, BTreeSet::from([id(&first), id(&second)]));

    // Register 587 reads 587: the battery voltage, in steps of 0.01 V.
    let now = SystemTime::now();
    core.storage
        .tick(now + Duration::from_secs(120))
        .await
        .unwrap();
    let series = core.bus.intern("battery.voltage", None);
    let history = core
        .storage
        .history(
            DeviceId(id(&first)),
            series,
            now - Duration::from_secs(60),
            now + Duration::from_secs(60),
        )
        .await
        .unwrap();
    assert_eq!(history.iter().find_map(|p| p.value), Some(5.87));
}

#[tokio::test]
async fn a_quantity_stored_nowhere_is_published_live_and_never_written() {
    let dir = tempfile::tempdir().unwrap();
    let (core, set_cookie) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    let device = fake::serve().await;
    let mut readings = core.bus.subscribe();
    let gateway = json!({ "name": "gateway", "transport": "modbus-tcp", "host": "127.0.0.1",
        "port": device.address.port() });
    let connection = core.connection(&set_cookie, &gateway).await;
    let deye = DeviceId(id(&core.deye(&set_cookie, &connection, 0).await));
    // The Deye profile keeps its internal CT total live only: `grid.power` is the record.
    let internal = core.bus.intern("extra.ac_total_internal_power", None);
    let voltage = core.bus.intern("battery.voltage", None);

    let mut live = BTreeSet::new();
    tokio::time::timeout(Duration::from_secs(20), async {
        while live.len() < 2 {
            let series = readings.recv().await.unwrap().series;
            live.extend([internal, voltage].into_iter().filter(|s| *s == series));
        }
    })
    .await
    .unwrap();
    let now = SystemTime::now();
    core.storage
        .tick(now + Duration::from_secs(120))
        .await
        .unwrap();
    let span = (now - Duration::from_secs(60), now + Duration::from_secs(60));
    let stored = |series| core.storage.history(deye, series, span.0, span.1);

    assert_ne!(stored(voltage).await.unwrap(), []);
    assert_eq!(stored(internal).await.unwrap(), []);
}

#[tokio::test]
async fn a_device_behind_a_solarman_stick_is_polled_at_its_unit_id() {
    let dir = tempfile::tempdir().unwrap();
    let (core, set_cookie) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    let mut stick = fake::serve_solarman().await;
    let mut readings = core.bus.subscribe();
    let connection = json!({ "name": "stick", "transport": "solarman-v5", "host": "127.0.0.1",
        "port": stick.address.port() });
    let connection = core.connection(&set_cookie, &connection).await;
    let device = core.deye(&set_cookie, &connection, 1).await;

    let (_probe, read) = tokio::time::timeout(Duration::from_secs(20), async {
        (
            stick.reads.recv().await.unwrap(),
            stick.reads.recv().await.unwrap(),
        )
    })
    .await
    .unwrap();
    assert_eq!(read.unit, 1);
    assert_eq!(readings.recv().await.unwrap().device.0, id(&device));
}

#[tokio::test]
async fn a_device_behind_an_rtu_gateway_is_polled_at_its_unit_id() {
    let dir = tempfile::tempdir().unwrap();
    let (core, set_cookie) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    let mut gateway = fake::serve_rtu().await;
    let mut readings = core.bus.subscribe();
    let connection = json!({ "name": "rs485", "transport": "rtu-over-tcp", "host": "127.0.0.1",
        "port": gateway.address.port() });
    let connection = core.connection(&set_cookie, &connection).await;
    let device = core.deye(&set_cookie, &connection, 1).await;

    let read = tokio::time::timeout(Duration::from_secs(20), gateway.reads.recv())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(read.unit, 1);
    assert_eq!(readings.recv().await.unwrap().device.0, id(&device));
    let (_, listed) = core.ask(&set_cookie, get("/api/v1/connections")).await;
    assert_eq!(listed["connections"][0]["transport"], json!("rtu-over-tcp"));
}

#[tokio::test]
async fn a_devices_writes_are_off_until_the_admin_turns_them_on() {
    let dir = tempfile::tempdir().unwrap();
    let (core, set_cookie) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    let connection = core.connection(&set_cookie, &gateway()).await;
    let device = core.deye(&set_cookie, &connection, 0).await;
    let (_, listed) = core.ask(&set_cookie, get("/api/v1/devices")).await;
    assert_eq!(listed["devices"][0]["writes"], json!(false));

    let mut on = deye(&connection, "deye-sg05lp3", 0);
    on["writes"] = json!(true);
    let (status, changed) = core
        .ask(
            &set_cookie,
            send("PUT", &format!("/api/v1/devices/{device}"), &on),
        )
        .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(changed["writes"], json!(true));
    let (_, log) = core.ask(&set_cookie, get("/api/v1/changes")).await;
    assert_eq!(log["changes"][2]["state"]["writes"], json!(true));
    // A change that leaves the switch out turns writes off.
    let (_, changed) = core
        .ask(
            &set_cookie,
            send(
                "PUT",
                &format!("/api/v1/devices/{device}"),
                &deye(&connection, "deye-sg05lp3", 0),
            ),
        )
        .await;
    assert_eq!(changed["writes"], json!(false));
}

#[tokio::test]
async fn a_modbus_connection_carries_its_poll_cycle_5_s_until_set() {
    let dir = tempfile::tempdir().unwrap();
    let (core, set_cookie) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    let id = core.connection(&set_cookie, &gateway()).await;
    let put = |body: Value| send("PUT", &format!("/api/v1/connections/{id}"), &body);
    let listed = async || {
        let (_, listed) = core.ask(&set_cookie, get("/api/v1/connections")).await;
        listed["connections"][0]["pollSeconds"].clone()
    };
    assert_eq!(listed().await, json!(5));

    let mut slow = gateway();
    slow["pollSeconds"] = json!(20);
    let (status, changed) = core.ask(&set_cookie, put(slow)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(changed["pollSeconds"], json!(20));
    assert_eq!(listed().await, json!(20));

    // A change that names no cycle keeps it.
    let mut renamed = gateway();
    renamed["name"] = json!("stick");
    let (_, changed) = core.ask(&set_cookie, put(renamed)).await;
    assert_eq!(changed["pollSeconds"], json!(20));

    let (_, log) = core.ask(&set_cookie, get("/api/v1/changes")).await;
    let cycles: Vec<&Value> = log["changes"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| &c["state"]["pollSeconds"])
        .collect();
    assert_eq!(cycles, [&json!(5), &json!(20), &json!(20)]);
}

#[tokio::test]
async fn a_poll_cycle_outside_1_to_60_s_is_refused() {
    let dir = tempfile::tempdir().unwrap();
    let (core, set_cookie) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    let id = core.connection(&set_cookie, &gateway()).await;
    let cycle = |seconds: u32| {
        let mut connection = gateway();
        connection["pollSeconds"] = json!(seconds);
        connection
    };

    for seconds in [0, 61, 3600] {
        let put = send("PUT", &format!("/api/v1/connections/{id}"), &cycle(seconds));
        assert_eq!(
            core.refused(&set_cookie, put).await,
            unprocessable("connection.poll-seconds"),
            "{seconds} s"
        );
        let post = send("POST", "/api/v1/connections", &cycle(seconds));
        assert_eq!(
            core.refused(&set_cookie, post).await,
            unprocessable("connection.poll-seconds"),
            "{seconds} s"
        );
    }
    for seconds in [1, 60] {
        let put = send("PUT", &format!("/api/v1/connections/{id}"), &cycle(seconds));
        let (status, changed) = core.ask(&set_cookie, put).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(changed["pollSeconds"], json!(seconds));
    }
    let (_, listed) = core.ask(&set_cookie, get("/api/v1/connections")).await;
    assert_eq!(listed["connections"].as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn a_broker_or_an_http_host_takes_no_poll_cycle() {
    let dir = tempfile::tempdir().unwrap();
    let (core, set_cookie) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    let host = json!({ "name": "meter", "transport": "http", "host": "127.0.0.1", "port": 9 });
    let id = core.connection(&set_cookie, &host).await;
    let (_, listed) = core.ask(&set_cookie, get("/api/v1/connections")).await;
    assert_eq!(listed["connections"][0].get("pollSeconds"), None);

    let mut cycled = host;
    cycled["pollSeconds"] = json!(10);
    let put = send("PUT", &format!("/api/v1/connections/{id}"), &cycled);
    assert_eq!(
        core.refused(&set_cookie, put).await,
        unprocessable("connection.poll-seconds")
    );
    let mut broker = json!({ "name": "broker", "transport": "mqtt", "host": "127.0.0.1",
        "port": 9, "topicRoot": "evcc" });
    broker["pollSeconds"] = json!(10);
    let post = send("POST", "/api/v1/connections", &broker);
    assert_eq!(
        core.refused(&set_cookie, post).await,
        unprocessable("connection.poll-seconds")
    );
}

/// The task stops and its replacement connects with the new cycle: its first readings, read at
/// once, carry it.
#[tokio::test]
async fn a_changed_poll_cycle_applies_at_once() {
    let dir = tempfile::tempdir().unwrap();
    let (core, set_cookie) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    let mut device = fake::serve().await;
    let mut gateway = json!({ "name": "gateway", "transport": "modbus-tcp", "host": "127.0.0.1",
        "port": device.address.port() });
    let connection = core.connection(&set_cookie, &gateway).await;
    core.deye(&set_cookie, &connection, 0).await;
    let mut readings = core.bus.subscribe();
    let first = readings.recv().await.unwrap();
    assert_eq!(first.cadence, Duration::from_secs(5));

    gateway["pollSeconds"] = json!(60);
    let put = send(
        "PUT",
        &format!("/api/v1/connections/{connection}"),
        &gateway,
    );
    assert_eq!(core.ask(&set_cookie, put).await.0, StatusCode::OK);

    tokio::time::timeout(Duration::from_secs(20), async {
        while device.reads.recv().await.unwrap().connection == 0 {}
        // A group's seconds round up to the cycle, so every reading now carries a minute.
        while readings.recv().await.unwrap().cadence != Duration::from_mins(1) {}
    })
    .await
    .expect("a new task at the new cycle");
}
