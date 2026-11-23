//! The reference plant (ADR 24), registered through the core's own API as an admin would set it
//! up: devices, the PV layout, the topology, the location, the timezone and the spot-price zone.

use std::net::SocketAddr;
use std::path::Path;
use std::sync::Arc;
use std::time::SystemTime;

use axum::body::Body;
use axum::extract::ConnectInfo;
use axum::http::{Request, StatusCode, header};
use serde_json::{Value, json};
use sunreye_core::api::{self, Api};
use sunreye_core::auth::Auth;
use sunreye_core::backup::Backups;
use sunreye_core::bus::{Bus, DeviceId};
use sunreye_core::cars::CarBodies;
use sunreye_core::changes::Changes;
use sunreye_core::correction::Corrections;
use sunreye_core::devices::Devices;
use sunreye_core::identity::Identity;
use sunreye_core::import::Imports;
use sunreye_core::layout::{Datasheet, Inverters, Layouts};
use sunreye_core::live::Live;
use sunreye_core::location::PlantLocation;
use sunreye_core::logs::Logs;
use sunreye_core::profiles::{self, Catalogue, Profiles};
use sunreye_core::spot::SpotZone;
use sunreye_core::storage::Storage;
use sunreye_core::tariff::Tariffs;
use sunreye_core::topology::Topologies;
use sunreye_core::views::Views;
use sunreye_core::weather;
use sunreye_pv as pv;
use tower::ServiceExt as _;

use crate::Error;
use crate::model::Wiring;

/// The admin password the generator sets, so the benchmark can sign in.
pub const PASSWORD: &str = "reference plant";
/// Berlin, to the 0.01° the core stores.
pub const LATITUDE: f64 = 52.52;
pub const LONGITUDE: f64 = 13.41;
pub const ZONE: &str = "Europe/Berlin";

/// A device of the plant: its name, profile, variant, transport, unit and topology claim.
pub struct Member {
    pub name: &'static str,
    pub profile: &'static str,
    pub variant: Option<&'static str>,
    pub transport: &'static str,
    pub unit: u8,
    pub kind: Kind,
}

/// What a device measures, which decides the values it reads.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    /// An inverter, by its place in [`Wiring`].
    Inverter(usize),
    GridMeter,
    HeatPumpMeter,
    Wallbox,
}

/// The devices in the order they are registered: ids 1 to 5.
pub const MEMBERS: [Member; 5] = [
    Member {
        name: "Hybrid",
        profile: "deye-sg01hp3",
        variant: Some("20k"),
        transport: "modbus-tcp",
        unit: 1,
        kind: Kind::Inverter(0),
    },
    Member {
        name: "Garage inverter",
        profile: "deye-sg05lp3",
        variant: Some("10k"),
        transport: "modbus-tcp",
        unit: 1,
        kind: Kind::Inverter(1),
    },
    Member {
        name: "Grid meter",
        profile: "shelly-pro-3em",
        variant: None,
        transport: "http",
        unit: 0,
        kind: Kind::GridMeter,
    },
    Member {
        name: "Wallbox",
        profile: "evcc",
        variant: None,
        transport: "mqtt",
        unit: 1,
        kind: Kind::Wallbox,
    },
    Member {
        name: "Heat pump meter",
        profile: "shelly-pro-3em",
        variant: None,
        transport: "http",
        unit: 0,
        kind: Kind::HeatPumpMeter,
    },
];

/// One string: its inverter's place in [`MEMBERS`], its MPPT input, modules, tilt and azimuth.
struct Stringing {
    name: &'static str,
    inverter: usize,
    input: u32,
    modules: u16,
    tilt: f64,
    azimuth: f64,
}

/// Five strings on the hybrid's two inputs, three on the garage inverter's two.
/// Strings in the layout.
pub const STRING_COUNT: usize = 8;
/// Each string's inverter, by its place in [`MEMBERS`].
pub const STRING_INVERTERS: [usize; STRING_COUNT] = [0, 0, 0, 0, 0, 1, 1, 1];

const STRINGS: [Stringing; STRING_COUNT] = [
    Stringing {
        name: "Roof south",
        inverter: 0,
        input: 1,
        modules: 7,
        tilt: 35.0,
        azimuth: 0.0,
    },
    Stringing {
        name: "Roof east",
        inverter: 0,
        input: 1,
        modules: 7,
        tilt: 35.0,
        azimuth: -90.0,
    },
    Stringing {
        name: "Roof west",
        inverter: 0,
        input: 1,
        modules: 7,
        tilt: 35.0,
        azimuth: 90.0,
    },
    Stringing {
        name: "Dormer left",
        inverter: 0,
        input: 2,
        modules: 8,
        tilt: 30.0,
        azimuth: 5.0,
    },
    Stringing {
        name: "Dormer right",
        inverter: 0,
        input: 2,
        modules: 8,
        tilt: 30.0,
        azimuth: 5.0,
    },
    Stringing {
        name: "Garage",
        inverter: 1,
        input: 1,
        modules: 10,
        tilt: 15.0,
        azimuth: 10.0,
    },
    Stringing {
        name: "Carport east",
        inverter: 1,
        input: 2,
        modules: 6,
        tilt: 10.0,
        azimuth: -80.0,
    },
    Stringing {
        name: "Carport west",
        inverter: 1,
        input: 2,
        modules: 6,
        tilt: 10.0,
        azimuth: 100.0,
    },
];
/// Wiring, soiling and mismatch.
const LOSS: f64 = 2.0;

/// AIKO-A450-MAH54Db, as the bundled catalogue prints it.
fn datasheet() -> Datasheet {
    Datasheet {
        name: "AIKO-A450-MAH54Db".to_owned(),
        pmax: 450.0,
        vmp: 34.5,
        imp: 13.05,
        voc: 40.94,
        isc: 14.12,
        power_coefficient: -0.26,
        voltage_coefficient: -0.22,
        current_coefficient: 0.05,
        width: 1.134,
        height: 1.757,
        bypass_diodes: 3,
    }
}

/// What the generator keeps of the registration.
pub struct Registered {
    pub catalogue: Catalogue,
    /// The devices' ids, in the order of [`MEMBERS`].
    pub devices: Vec<u32>,
    /// Each string's id and MPPT input, in the layout's order.
    pub strings: Vec<(u32, u32)>,
    pub layouts: Layouts,
    pub topologies: Topologies,
    pub wiring: Wiring,
}

/// A profile index fetch never leaves the machine.
#[derive(Debug)]
struct Offline;

impl profiles::Fetch for Offline {
    fn get(&self, url: &str) -> Result<Vec<u8>, String> {
        Err(format!("{url}: offline"))
    }
}

/// Registers the reference plant on `storage` at `at`, through the router the core serves.
/// Device tasks started for the registration stop when it returns; they reach only closed
/// loopback ports.
///
/// # Errors
/// A request is refused, or the store fails.
#[expect(
    clippy::too_many_lines,
    reason = "the API's modules, then one request per step"
)]
pub async fn register(
    storage: &Storage,
    bus: &Bus,
    data_dir: &Path,
    at: SystemTime,
) -> Result<Registered, Error> {
    let database = storage.database();
    Identity::open(&database).await.map_err(Error::core)?;
    let profiles = Profiles::open(database.clone(), Arc::new(Offline), None)
        .await
        .map_err(Error::core)?;
    let inverters = Inverters::default();
    let devices = Devices::start(
        database.clone(),
        storage.declarer(),
        profiles.catalogue(),
        bus.clone(),
        inverters.clone(),
    )
    .await
    .map_err(Error::core)?;
    let layouts = Layouts::new(database.clone(), inverters);
    let catalogue = profiles.catalogue();
    let topologies = Topologies::new(database.clone());
    let share = data_dir.join("share");
    let api = Api {
        auth: Auth::open(database.clone(), None)
            .await
            .map_err(Error::core)?,
        live: Live::spawn(bus),
        problems: tokio::sync::watch::channel(Vec::new()).1,
        history: storage.reader(),
        corrections: Corrections::new(layouts.clone(), weather::DEVICE, storage),
        layouts: layouts.clone(),
        devices,
        changes: Changes::new(database.clone()),
        location: PlantLocation::open(database.clone())
            .await
            .map_err(Error::core)?,
        spot: SpotZone::open(database.clone())
            .await
            .map_err(Error::core)?,
        imports: Imports::new(
            (share.clone(), data_dir.join("import.tar.gz"), 0),
            storage,
            bus,
            profiles.catalogue(),
        ),
        backups: Backups::new(database.clone(), data_dir.to_owned(), share),
        profiles,
        topologies: topologies.clone(),
        tariffs: Tariffs::new(storage, bus, storage.zones().watch()),
        cars: CarBodies::new(data_dir.join("cars")),
        views: Views::new(database),
        storage: storage.settings(),
        logs: Logs::default(),
        clock: Arc::new(move || at),
    };
    let admin = Admin::sign_up(api::router(api)).await?;
    admin
        .put("/api/v1/timezone", &json!({ "name": ZONE }))
        .await?;
    let location = json!({ "latitude": LATITUDE, "longitude": LONGITUDE });
    admin.put("/api/v1/location", &location).await?;
    admin
        .put("/api/v1/spot-prices", &json!({ "zone": "DE-LU" }))
        .await?;
    let ids = admin.devices().await?;
    let module = admin.post("/api/v1/module-types", &module_type()).await?;
    let strings: Vec<Value> = STRINGS
        .iter()
        .map(|s| {
            json!({
                "name": s.name, "moduleType": module.get("id"), "device": ids.get(s.inverter),
                "input": s.input, "modules": s.modules, "optimized": 0, "tilt": s.tilt,
                "azimuth": s.azimuth, "loss": LOSS,
            })
        })
        .collect();
    let from = jiff::Timestamp::try_from(at).map_err(|e| Error::Setup(e.to_string()))?;
    let layout = json!({ "appliesFrom": from.to_string(), "strings": strings });
    let layout = admin.put("/api/v1/layout", &layout).await?;
    let strings = layout
        .get("strings")
        .and_then(Value::as_array)
        .map(|strings| {
            strings
                .iter()
                .filter_map(|s| {
                    let id = s.get("id")?.as_u64()?;
                    let input = s.get("input")?.as_u64()?;
                    Some((u32::try_from(id).ok()?, u32::try_from(input).ok()?))
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let devices = ids
        .iter()
        .filter_map(|id| u32::try_from(id.as_u64()?).ok())
        .collect();
    admin
        .put("/api/v1/topology", &topology(&from.to_string(), &ids))
        .await?;
    let wiring = wiring(&layouts)?;
    Ok(Registered {
        catalogue,
        devices,
        strings,
        layouts,
        topologies,
        wiring,
    })
}

/// The grid meter at the connection point over the two inverters' PV, the battery and the
/// wallbox.
fn topology(applies_from: &str, ids: &[Value]) -> Value {
    let id = |at: usize| ids.get(at).cloned().unwrap_or(Value::Null);
    let point = |name: &str, parent: Value, device: Value, role: &str| json!({ "name": name, "parent": parent, "claims": [{ "device": device, "role": role }] });
    json!({
        "appliesFrom": applies_from,
        "points": [
            point("Grid", Value::Null, id(2), "grid.power"),
            point("Hybrid PV", json!(0), id(0), "pv.power"),
            point("Battery", json!(0), id(0), "battery.power"),
            point("Garage PV", json!(0), id(1), "pv.power"),
            point("Wallbox", json!(0), id(3), "ev.charge.power"),
        ],
    })
}

fn module_type() -> Value {
    let d = datasheet();
    json!({
        "name": d.name, "pmax": d.pmax, "vmp": d.vmp, "imp": d.imp, "voc": d.voc, "isc": d.isc,
        "powerCoefficient": d.power_coefficient, "voltageCoefficient": d.voltage_coefficient,
        "currentCoefficient": d.current_coefficient, "width": d.width, "height": d.height,
        "bypassDiodes": d.bypass_diodes,
    })
}

/// The layout as the `pv` model takes it, with the limits and AC ratings the inverters'
/// profiles declare, as the core's own model reads them.
fn wiring(layouts: &Layouts) -> Result<Wiring, Error> {
    let module = datasheet().model();
    let mut inverters = Vec::new();
    let mut ratings = [0.0; 2];
    for (place, rating) in ratings.iter_mut().enumerate() {
        let device = u32::try_from(place + 1).map_err(|e| Error::Setup(e.to_string()))?;
        let inverter = layouts
            .inverters()
            .limits(DeviceId(device), None)
            .ok_or_else(|| Error::Setup(format!("device {device} is no inverter")))?;
        *rating = inverter.ac_rating.unwrap_or(f64::INFINITY);
        let inputs = (1_u32..=2)
            .zip(&inverter.inputs)
            .map(|(input, limits)| pv::Input {
                limits: Some(*limits),
                strings: STRINGS
                    .iter()
                    .filter(|s| s.inverter == place && s.input == input)
                    .map(|s| {
                        let plane = pv::Plane {
                            tilt: s.tilt,
                            azimuth: s.azimuth,
                        };
                        pv::PvString::on_one_plane(module, plane, s.modules, 0, LOSS)
                    })
                    .collect(),
            })
            .collect();
        inverters.push(pv::Inverter { inputs, ac: None });
    }
    Ok(Wiring {
        layout: pv::Layout {
            location: pv::Location {
                latitude: LATITUDE,
                longitude: LONGITUDE,
            },
            inverters,
            occluders: Vec::new(),
        },
        ratings,
    })
}

/// The admin's session on the router.
struct Admin {
    router: axum::Router,
    cookie: String,
}

/// Where the requests come from: the core's own host.
const HOME: SocketAddr =
    SocketAddr::new(std::net::IpAddr::V4(std::net::Ipv4Addr::LOCALHOST), 50_000);

impl Admin {
    /// Sets the admin password on the first run and signs in.
    async fn sign_up(router: axum::Router) -> Result<Self, Error> {
        let password = json!({ "password": PASSWORD });
        let mut admin = Self {
            router,
            cookie: String::new(),
        };
        admin.send("POST", "/api/v1/setup", &password).await?;
        let response = admin.request("POST", "/api/v1/login", &password).await?;
        let cookie = response
            .headers()
            .get(header::SET_COOKIE)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.split(';').next())
            .ok_or_else(|| Error::Setup("no session".to_owned()))?;
        cookie.clone_into(&mut admin.cookie);
        Ok(admin)
    }

    /// Adds each of [`MEMBERS`] with a connection of its own, to a closed loopback port; answers
    /// their ids.
    async fn devices(&self) -> Result<Vec<Value>, Error> {
        let mut ids = Vec::new();
        for (port, member) in (1_u16..).zip(&MEMBERS) {
            let root = (member.transport == "mqtt").then_some("evcc");
            let connection = json!({
                "name": member.name, "transport": member.transport, "host": "127.0.0.1",
                "port": port, "topicRoot": root,
            });
            let connection = self.post("/api/v1/connections", &connection).await?;
            let device = json!({
                "name": member.name, "connection": connection.get("id"),
                "profile": member.profile, "variant": member.variant, "unit": member.unit,
            });
            let device = self.post("/api/v1/devices", &device).await?;
            ids.push(device.get("id").cloned().unwrap_or_default());
        }
        Ok(ids)
    }

    async fn put(&self, uri: &str, body: &Value) -> Result<Value, Error> {
        self.send("PUT", uri, body).await
    }

    async fn post(&self, uri: &str, body: &Value) -> Result<Value, Error> {
        self.send("POST", uri, body).await
    }

    async fn send(&self, method: &str, uri: &str, body: &Value) -> Result<Value, Error> {
        let response = self.request(method, uri, body).await?;
        let status = response.status();
        let bytes = axum::body::to_bytes(response.into_body(), 1 << 20)
            .await
            .map_err(|e| Error::Setup(e.to_string()))?;
        let answer = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
        if status.is_success() {
            Ok(answer)
        } else {
            Err(Error::Setup(format!("{method} {uri}: {status} {answer}")))
        }
    }

    async fn request(
        &self,
        method: &str,
        uri: &str,
        body: &Value,
    ) -> Result<axum::response::Response, Error> {
        let mut request = Request::builder()
            .method(method)
            .uri(uri)
            .header(header::CONTENT_TYPE, "application/json");
        if !self.cookie.is_empty() {
            request = request.header(header::COOKIE, &self.cookie);
        }
        let mut request = request
            .body(Body::from(body.to_string()))
            .map_err(|e| Error::Setup(e.to_string()))?;
        request.extensions_mut().insert(ConnectInfo(HOME));
        let response = self
            .router
            .clone()
            .oneshot(request)
            .await
            .map_err(|e| Error::Setup(e.to_string()))?;
        if response.status() == StatusCode::TOO_MANY_REQUESTS {
            return Err(Error::Setup(format!("{method} {uri}: throttled")));
        }
        Ok(response)
    }
}
