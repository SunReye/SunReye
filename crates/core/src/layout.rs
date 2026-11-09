//! The PV layout (ADR 17): module types and strings wired to inverters' MPPT inputs.
//!
//! The layout module owns the `module_type`, `pv_string`, `layout` and `layout_string` tables.
//! Ids are never reused; a change is a new version applying from its instant.

use std::collections::HashMap;
use std::sync::{Arc, PoisonError, RwLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use axum::Json;
use axum::extract::rejection::{JsonRejection, QueryRejection};
use axum::extract::{Query, State};
use axum::http::StatusCode;
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use sunreye_profile::Profile;
use utoipa::{IntoParams, ToSchema};
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;

use crate::api::{Clock, Code, Problem, ProblemDetails};
use crate::bus::DeviceId;
use crate::storage::{Database, Error};

const BODY: Problem = Problem {
    status: StatusCode::BAD_REQUEST,
    code: Code::RequestBody,
};
const QUERY: Problem = Problem {
    status: StatusCode::BAD_REQUEST,
    code: Code::RequestQuery,
};
const NONE: Problem = Problem {
    status: StatusCode::NOT_FOUND,
    code: Code::LayoutNone,
};
const INTERNAL: Problem = Problem {
    status: StatusCode::INTERNAL_SERVER_ERROR,
    code: Code::Internal,
};
/// Who changes the layout: the one admin (ADR 9).
const ACTOR: &str = "admin";

/// Why a layout or module type was refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Refusal {
    /// The string names no known inverter.
    Device,
    /// The inverter's profile declares no such MPPT input.
    Input,
    /// An id no string ever had, or one named twice.
    String,
    ModuleType,
    /// A value out of its physical range.
    Value,
}

impl From<Refusal> for Problem {
    fn from(refusal: Refusal) -> Self {
        let code = match refusal {
            Refusal::Device => Code::LayoutDevice,
            Refusal::Input => Code::LayoutInput,
            Refusal::String => Code::LayoutString,
            Refusal::ModuleType => Code::LayoutModuleType,
            Refusal::Value => Code::LayoutValue,
        };
        Self {
            status: StatusCode::UNPROCESSABLE_ENTITY,
            code,
        }
    }
}

/// The inverters strings may be wired to, by device, with their profiles. Clones share one set,
/// which the devices module replaces as devices change.
#[derive(Debug, Clone, Default)]
pub struct Inverters(Arc<RwLock<HashMap<DeviceId, Arc<Profile>>>>);

impl FromIterator<(DeviceId, Arc<Profile>)> for Inverters {
    fn from_iter<I: IntoIterator<Item = (DeviceId, Arc<Profile>)>>(iter: I) -> Self {
        Self(Arc::new(RwLock::new(iter.into_iter().collect())))
    }
}

impl Inverters {
    #[must_use]
    pub fn profile(&self, device: DeviceId) -> Option<Arc<Profile>> {
        let inverters = self.0.read().unwrap_or_else(PoisonError::into_inner);
        inverters.get(&device).cloned()
    }

    /// Replaces the set for every clone.
    pub fn replace(&self, inverters: impl IntoIterator<Item = (DeviceId, Arc<Profile>)>) {
        let inverters = inverters.into_iter().collect();
        *self.0.write().unwrap_or_else(PoisonError::into_inner) = inverters;
    }
}

/// A PV module model's datasheet values.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Datasheet {
    pub name: String,
    /// Watts at standard test conditions.
    pub pmax: f64,
    /// Volts and amperes at the maximum power point.
    pub vmp: f64,
    pub imp: f64,
    /// Open-circuit volts and short-circuit amperes.
    pub voc: f64,
    pub isc: f64,
    /// Of Pmax, Voc and Isc, in %/K.
    pub power_coefficient: f64,
    pub voltage_coefficient: f64,
    pub current_coefficient: f64,
    /// Metres.
    pub width: f64,
    pub height: f64,
    pub bypass_diodes: u8,
}

#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct ModuleType {
    /// Stable; never reused.
    pub id: u32,
    #[serde(flatten)]
    pub datasheet: Datasheet,
}

/// Where a string sits and what it is made of.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Wiring {
    pub name: String,
    /// A module type id.
    pub module_type: u32,
    /// The inverter's device id.
    pub device: u32,
    /// The MPPT input, from 1, as the `pv.mppt.*` index.
    pub input: u32,
    pub modules: u16,
    /// How many of its modules have an optimizer.
    pub optimized: u16,
    /// Degrees from horizontal.
    pub tilt: f64,
    /// Degrees: 0 south, −90 east, 90 west.
    pub azimuth: f64,
    /// Wiring, soiling and mismatch, in %.
    pub loss: f64,
}

/// Modules in series on one plane; strings on one MPPT input are in parallel.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct PvString {
    /// Stable; never reused. The `pv.string.power` index.
    pub id: u32,
    #[serde(flatten)]
    pub wiring: Wiring,
}

#[derive(Deserialize, ToSchema)]
pub struct StringDraft {
    /// A string kept from an earlier version; absent for a new string.
    pub id: Option<u32>,
    #[serde(flatten)]
    pub wiring: Wiring,
}

/// One layout version.
#[derive(Debug, Clone, PartialEq)]
pub struct Version {
    pub applies_from: SystemTime,
    pub strings: Vec<PvString>,
}

/// The version in force at `at`; `versions` in the order [`Layouts::versions`] returns.
#[must_use]
pub fn in_force(versions: &[Version], at: SystemTime) -> Option<&Version> {
    versions.iter().rev().find(|v| v.applies_from <= at)
}

/// The layout feature module.
#[derive(Debug, Clone)]
pub struct Layouts {
    database: Database,
    inverters: Inverters,
}

impl Layouts {
    #[must_use]
    pub const fn new(database: Database, inverters: Inverters) -> Self {
        Self {
            database,
            inverters,
        }
    }

    #[must_use]
    pub const fn inverters(&self) -> &Inverters {
        &self.inverters
    }

    /// Every module type, by id.
    ///
    /// # Errors
    /// The file cannot be read.
    pub async fn module_types(&self) -> Result<Vec<ModuleType>, Error> {
        self.database.run(read_module_types).await
    }

    /// Every version, by the instant it applies from, a later change after an earlier one.
    ///
    /// # Errors
    /// The file cannot be read.
    pub async fn versions(&self) -> Result<Vec<Version>, Error> {
        self.database.run(read_versions).await
    }

    /// Adds a module type with a fresh id.
    ///
    /// # Errors
    /// A datasheet value is not physical, or the file cannot be written.
    pub async fn add_module_type(&self, datasheet: Datasheet) -> Result<ModuleType, Problem> {
        if !physical(&datasheet) {
            return Err(Refusal::Value.into());
        }
        let stored = datasheet.clone();
        let id = self
            .database
            .run(move |db| insert_module_type(db, &stored))
            .await
            .map_err(|_| INTERNAL)?;
        Ok(ModuleType { id, datasheet })
    }

    /// Appends a version applying from `applies_from`; new strings get fresh ids.
    ///
    /// # Errors
    /// A string names an unknown inverter, MPPT input, string id or module type, or a value is
    /// out of range, or the file cannot be written.
    pub async fn change(
        &self,
        applies_from: SystemTime,
        strings: Vec<StringDraft>,
        changed: SystemTime,
    ) -> Result<Version, Problem> {
        for draft in &strings {
            self.check(&draft.wiring)?;
        }
        let stored = self
            .database
            .run(move |db| insert_version(db, applies_from, strings, changed))
            .await
            .map_err(|_| INTERNAL)?;
        Ok(stored?)
    }

    fn check(&self, wiring: &Wiring) -> Result<(), Refusal> {
        let profile = self
            .inverters
            .profile(DeviceId(wiring.device))
            .ok_or(Refusal::Device)?;
        // Without declared inputs (ADR 5) any input is taken and nothing is capped.
        let inputs = profile.inverter().map_or(usize::MAX, |i| i.mppt.len());
        let input = usize::try_from(wiring.input).unwrap_or(usize::MAX);
        if input == 0 || input > inputs {
            return Err(Refusal::Input);
        }
        let plane = (0.0..=90.0).contains(&wiring.tilt)
            && (-180.0..=180.0).contains(&wiring.azimuth)
            && (0.0..100.0).contains(&wiring.loss);
        if wiring.modules == 0 || wiring.optimized > wiring.modules || !plane {
            return Err(Refusal::Value);
        }
        Ok(())
    }

    /// The module type and layout routes, behind the admin's session.
    pub fn routes(self, clock: Clock) -> OpenApiRouter {
        OpenApiRouter::new()
            .routes(routes!(list_module_types, add_module_type))
            .routes(routes!(layout, change_layout))
            .with_state((self, clock))
    }
}

fn physical(d: &Datasheet) -> bool {
    let positive = [d.pmax, d.vmp, d.imp, d.voc, d.isc, d.width, d.height];
    let coefficients = [
        d.power_coefficient,
        d.voltage_coefficient,
        d.current_coefficient,
    ];
    positive.iter().all(|v| v.is_finite() && *v > 0.0) && coefficients.iter().all(|v| v.is_finite())
}

fn seconds(time: SystemTime) -> i64 {
    let since = time.duration_since(UNIX_EPOCH).unwrap_or_default();
    i64::try_from(since.as_secs()).unwrap_or(i64::MAX)
}

fn time(seconds: i64) -> SystemTime {
    UNIX_EPOCH + Duration::from_secs(u64::try_from(seconds).unwrap_or(0))
}

fn insert_module_type(db: &Connection, d: &Datasheet) -> rusqlite::Result<u32> {
    db.execute(
        "INSERT INTO module_type (name, pmax, vmp, imp, voc, isc, power_coefficient,
           voltage_coefficient, current_coefficient, width, height, bypass_diodes)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        params![
            d.name,
            d.pmax,
            d.vmp,
            d.imp,
            d.voc,
            d.isc,
            d.power_coefficient,
            d.voltage_coefficient,
            d.current_coefficient,
            d.width,
            d.height,
            d.bypass_diodes
        ],
    )?;
    Ok(u32::try_from(db.last_insert_rowid()).unwrap_or(u32::MAX))
}

fn read_module_types(db: &Connection) -> rusqlite::Result<Vec<ModuleType>> {
    db.prepare(
        "SELECT id, name, pmax, vmp, imp, voc, isc, power_coefficient, voltage_coefficient,
           current_coefficient, width, height, bypass_diodes
         FROM module_type ORDER BY id",
    )?
    .query_map([], |row| {
        Ok(ModuleType {
            id: row.get(0)?,
            datasheet: Datasheet {
                name: row.get(1)?,
                pmax: row.get(2)?,
                vmp: row.get(3)?,
                imp: row.get(4)?,
                voc: row.get(5)?,
                isc: row.get(6)?,
                power_coefficient: row.get(7)?,
                voltage_coefficient: row.get(8)?,
                current_coefficient: row.get(9)?,
                width: row.get(10)?,
                height: row.get(11)?,
                bypass_diodes: row.get(12)?,
            },
        })
    })?
    .collect()
}

/// Appends a version, issuing ids to new strings; refuses an unknown string or module type.
fn insert_version(
    db: &Connection,
    applies_from: SystemTime,
    drafts: Vec<StringDraft>,
    changed: SystemTime,
) -> rusqlite::Result<Result<Version, Refusal>> {
    let tx = db.unchecked_transaction()?;
    let mut strings: Vec<PvString> = Vec::with_capacity(drafts.len());
    for draft in drafts {
        let id = match string_id(&tx, draft.id, &strings)? {
            Ok(id) => id,
            Err(refusal) => return Ok(Err(refusal)),
        };
        let module = tx
            .query_row(
                "SELECT 1 FROM module_type WHERE id = ?1",
                [draft.wiring.module_type],
                |_| Ok(()),
            )
            .optional()?;
        if module.is_none() {
            return Ok(Err(Refusal::ModuleType));
        }
        strings.push(PvString {
            id,
            wiring: draft.wiring,
        });
    }
    tx.execute(
        "INSERT INTO layout (applies_from, changed, actor) VALUES (?1, ?2, ?3)",
        params![seconds(applies_from), seconds(changed), ACTOR],
    )?;
    let layout = tx.last_insert_rowid();
    for s in &strings {
        insert_string(&tx, layout, s)?;
    }
    tx.commit()?;
    Ok(Ok(Version {
        applies_from: time(seconds(applies_from)),
        strings,
    }))
}

/// A kept string's id, once per version, or a fresh one.
fn string_id(
    db: &Connection,
    kept: Option<u32>,
    strings: &[PvString],
) -> rusqlite::Result<Result<u32, Refusal>> {
    let Some(id) = kept else {
        db.execute("INSERT INTO pv_string DEFAULT VALUES", [])?;
        return Ok(Ok(u32::try_from(db.last_insert_rowid()).unwrap_or(u32::MAX)));
    };
    if strings.iter().any(|s| s.id == id) {
        return Ok(Err(Refusal::String));
    }
    let known = db
        .query_row("SELECT 1 FROM pv_string WHERE id = ?1", [id], |_| Ok(()))
        .optional()?;
    Ok(known.map(|()| id).ok_or(Refusal::String))
}

fn insert_string(db: &Connection, layout: i64, s: &PvString) -> rusqlite::Result<()> {
    let w = &s.wiring;
    db.execute(
        "INSERT INTO layout_string (layout, string, name, module_type, device, input, modules,
           optimized, tilt, azimuth, loss)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            layout,
            s.id,
            w.name,
            w.module_type,
            w.device,
            w.input,
            w.modules,
            w.optimized,
            w.tilt,
            w.azimuth,
            w.loss
        ],
    )?;
    Ok(())
}

fn read_versions(db: &Connection) -> rusqlite::Result<Vec<Version>> {
    let mut strings = db.prepare(
        "SELECT string, name, module_type, device, input, modules, optimized, tilt, azimuth, loss
         FROM layout_string WHERE layout = ?1 ORDER BY string",
    )?;
    let layouts: Vec<(i64, i64)> = db
        .prepare("SELECT id, applies_from FROM layout ORDER BY applies_from, id")?
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
        .collect::<rusqlite::Result<_>>()?;
    layouts
        .into_iter()
        .map(|(id, applies_from)| {
            let strings = strings
                .query_map([id], |row| {
                    Ok(PvString {
                        id: row.get(0)?,
                        wiring: Wiring {
                            name: row.get(1)?,
                            module_type: row.get(2)?,
                            device: row.get(3)?,
                            input: row.get(4)?,
                            modules: row.get(5)?,
                            optimized: row.get(6)?,
                            tilt: row.get(7)?,
                            azimuth: row.get(8)?,
                            loss: row.get(9)?,
                        },
                    })
                })?
                .collect::<rusqlite::Result<_>>()?;
            Ok(Version {
                applies_from: time(applies_from),
                strings,
            })
        })
        .collect()
}

type LayoutState = State<(Layouts, Clock)>;

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
struct ModuleTypes {
    module_types: Vec<ModuleType>,
}

#[utoipa::path(get, path = "/api/v1/module-types", responses(
    (status = 200, body = ModuleTypes),
    (status = 401, body = ProblemDetails, content_type = "application/problem+json"),
))]
async fn list_module_types(State((layouts, _)): LayoutState) -> Result<Json<ModuleTypes>, Problem> {
    let module_types = layouts.module_types().await.map_err(|_| INTERNAL)?;
    Ok(Json(ModuleTypes { module_types }))
}

/// Adds a module type; the admin enters its datasheet, there is no catalogue.
#[utoipa::path(post, path = "/api/v1/module-types", request_body = Datasheet, responses(
    (status = 201, body = ModuleType),
    (status = "4XX", body = ProblemDetails, content_type = "application/problem+json"),
))]
async fn add_module_type(
    State((layouts, _)): LayoutState,
    body: Result<Json<Datasheet>, JsonRejection>,
) -> Result<(StatusCode, Json<ModuleType>), Problem> {
    let Json(datasheet) = body.map_err(|_| BODY)?;
    let added = layouts.add_module_type(datasheet).await?;
    Ok((StatusCode::CREATED, Json(added)))
}

/// One layout version.
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
struct Layout {
    /// RFC 3339, UTC.
    applies_from: String,
    strings: Vec<PvString>,
}

impl From<&Version> for Layout {
    fn from(version: &Version) -> Self {
        Self {
            applies_from: jiff::Timestamp::try_from(version.applies_from)
                .map(|t| t.to_string())
                .unwrap_or_default(),
            strings: version.strings.clone(),
        }
    }
}

#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
struct At {
    /// RFC 3339; now when absent.
    at: Option<String>,
}

/// The layout in force at an instant.
#[utoipa::path(get, path = "/api/v1/layout", params(At), responses(
    (status = 200, body = Layout),
    (status = "4XX", body = ProblemDetails, content_type = "application/problem+json"),
))]
async fn layout(
    State((layouts, clock)): LayoutState,
    at: Result<Query<At>, QueryRejection>,
) -> Result<Json<Layout>, Problem> {
    let Query(At { at }) = at.map_err(|_| QUERY)?;
    let at = at.as_deref().map_or_else(|| Ok(clock()), instant)?;
    let versions = layouts.versions().await.map_err(|_| INTERNAL)?;
    in_force(&versions, at).map(|v| Json(v.into())).ok_or(NONE)
}

/// A layout change: every string, applying from an instant on.
#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
struct Change {
    /// RFC 3339.
    applies_from: String,
    strings: Vec<StringDraft>,
}

/// Changes the layout from an instant on; new strings get fresh ids.
#[utoipa::path(put, path = "/api/v1/layout", request_body = Change, responses(
    (status = 200, body = Layout),
    (status = "4XX", body = ProblemDetails, content_type = "application/problem+json"),
))]
async fn change_layout(
    State((layouts, clock)): LayoutState,
    body: Result<Json<Change>, JsonRejection>,
) -> Result<Json<Layout>, Problem> {
    let Json(change) = body.map_err(|_| BODY)?;
    let applies_from = instant(&change.applies_from).map_err(|_| BODY)?;
    let version = layouts
        .change(applies_from, change.strings, clock())
        .await?;
    Ok(Json((&version).into()))
}

fn instant(text: &str) -> Result<SystemTime, Problem> {
    let instant: jiff::Timestamp = text.parse().map_err(|_| QUERY)?;
    Ok(instant.into())
}
