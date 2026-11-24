//! The PV layout (ADR 17): module types and strings wired to inverters' MPPT inputs.
//!
//! The layout module owns the `module_type`, `pv_string`, `layout`, `layout_string`,
//! `layout_scene` and `layout_types` tables. Ids are never reused; a layout keeps one version per
//! instant it applies from, and each stored change appends to the change log (ADR 19). A version
//! with a scene (ADR 20) derives its strings' planes and module counts from it. Its devices'
//! inverter and battery types are copied into it by value (ADR 27).

use std::collections::{BTreeMap, HashMap};
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use axum::Json;
use axum::extract::rejection::{JsonRejection, QueryRejection};
use axum::extract::{Query, State};
use axum::http::StatusCode;
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use sunreye_catalogue::modules as catalogue;
pub use sunreye_catalogue::modules::Datasheet;
use sunreye_profile::{Inverter, Profile};
use sunreye_pv::{self as pv, Scene};
use tokio::sync::watch;
use utoipa::{IntoParams, ToSchema};
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;

use crate::api::{Clock, Code, Problem, ProblemDetails, Refused, internal};
use crate::bus::DeviceId;
use crate::changes::{self, Action, Entry, Subject};
use crate::storage::{Database, Error};

mod scene;
#[cfg(test)]
mod tests;

const BODY: Problem = Problem {
    status: StatusCode::BAD_REQUEST,
    code: Code::RequestBody,
};
const QUERY: Problem = Problem {
    status: StatusCode::BAD_REQUEST,
    code: Code::RequestQuery,
};
const VALUE: Problem = Problem {
    status: StatusCode::UNPROCESSABLE_ENTITY,
    code: Code::LayoutValue,
};
const NONE: Problem = Problem {
    status: StatusCode::NOT_FOUND,
    code: Code::LayoutNone,
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
    /// A value out of its physical range: a string's by its position, else the datasheet's.
    Value {
        string: Option<usize>,
        field: &'static str,
    },
    /// A scene's grid names no roof face, a module no string or one of another module type, an
    /// equipment marker lies off its wall, a car place, ground surface, fence, opening, roof
    /// chimney or roof window is refused.
    Scene,
    /// A module crosses its face's setback.
    Setback,
    /// Two modules overlap.
    Overlap,
    /// A module overlaps a roof chimney, a roof window or existing PV.
    Covered,
}

impl From<Refusal> for Refused {
    fn from(refusal: Refusal) -> Self {
        let pointer = if let Refusal::Value { string, field } = refusal {
            Some(string.map_or_else(
                || format!("/{field}"),
                |at| format!("/strings/{at}/{field}"),
            ))
        } else {
            None
        };
        Self {
            problem: refusal.into(),
            pointer,
            series: None,
        }
    }
}

impl From<Refusal> for Problem {
    fn from(refusal: Refusal) -> Self {
        let code = match refusal {
            Refusal::Device => Code::LayoutDevice,
            Refusal::Input => Code::LayoutInput,
            Refusal::String => Code::LayoutString,
            Refusal::ModuleType => Code::LayoutModuleType,
            Refusal::Value { .. } => Code::LayoutValue,
            Refusal::Scene => Code::LayoutScene,
            Refusal::Setback => Code::LayoutSetback,
            Refusal::Overlap => Code::LayoutOverlap,
            Refusal::Covered => Code::LayoutCovered,
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
        let inverters = crate::read(&self.0);
        inverters.get(&device).cloned()
    }

    /// The device's limits: from its inverter type in `types` when it has one, else from its
    /// profile, whole and never mixed (ADR 27). None when neither describes its DC side.
    #[must_use]
    pub fn limits(&self, device: DeviceId, types: Option<&Types>) -> Option<Limits> {
        if let Some(typed) = types.and_then(|t| t.inverter_types.get(&device.0)) {
            return Some(Limits {
                max_input_voltage: typed.max_input_voltage,
                ac_rating: Some(typed.ac_rating),
                efficiency: Some(typed.efficiency),
                inputs: typed.limits(),
            });
        }
        let profile = self.profile(device)?;
        profile.inverter().map(Limits::of)
    }

    /// Every device a string may name: each with a profile, in id order.
    #[must_use]
    pub fn devices(&self) -> Vec<DeviceId> {
        let mut devices: Vec<DeviceId> = crate::read(&self.0).keys().copied().collect();
        devices.sort_unstable_by_key(|d| d.0);
        devices
    }

    /// Replaces the set for every clone.
    pub fn replace(&self, inverters: impl IntoIterator<Item = (DeviceId, Arc<Profile>)>) {
        let inverters = inverters.into_iter().collect();
        *crate::write(&self.0) = inverters;
    }
}

/// An inverter's limits as a layout reads them (ADR 17, 27).
#[derive(Debug, Clone, PartialEq)]
pub struct Limits {
    /// Volts.
    pub max_input_voltage: f64,
    /// Watts of AC output.
    pub ac_rating: Option<f64>,
    /// The European weighted efficiency, in %. Only an inverter type has one: no profile
    /// declares it.
    pub efficiency: Option<f64>,
    /// The MPPT inputs from 1, in order.
    pub inputs: Vec<pv::MpptLimits>,
}

impl Limits {
    fn of(inverter: &Inverter) -> Self {
        Self {
            max_input_voltage: inverter.max_input_voltage,
            ac_rating: inverter.ac_rating,
            efficiency: None,
            inputs: inverter
                .mppt
                .iter()
                .map(|m| pv::MpptLimits {
                    max_current: m.max_current,
                    min_voltage: m.min_voltage,
                    max_voltage: m.max_voltage,
                    start_voltage: m.start_voltage,
                })
                .collect(),
        }
    }
}

/// The inverter and battery types a version's devices carry, by device id, copied by value
/// (ADR 27). Stored as this JSON, which refuses a member this build does not know (ADR 25).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Types {
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub inverter_types: BTreeMap<u32, pv::InverterType>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub battery_types: BTreeMap<u32, pv::BatteryType>,
}

impl Types {
    fn is_empty(&self) -> bool {
        self.inverter_types.is_empty() && self.battery_types.is_empty()
    }

    /// The first unphysical value, as a JSON pointer into a layout change.
    fn unphysical(&self) -> Option<String> {
        let inverters = self
            .inverter_types
            .iter()
            .find_map(|(device, t)| Some(format!("/inverterTypes/{device}/{}", t.unphysical()?)));
        inverters.or_else(|| {
            self.battery_types
                .iter()
                .find_map(|(device, t)| Some(format!("/batteryTypes/{device}/{}", t.unphysical()?)))
        })
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct ModuleType {
    /// Stable; never reused.
    pub id: u32,
    #[serde(flatten)]
    pub datasheet: Datasheet,
}

/// Where a string sits and what it is made of. With a scene, its module counts and plane are
/// derived: the plane is that of its first module.
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

/// What a layout change sets: every string, the scene and the devices' types.
pub struct Draft {
    pub strings: Vec<StringDraft>,
    /// Its modules name their string by position in `strings`.
    pub scene: Option<Scene>,
    pub types: Types,
}

impl Draft {
    /// A change without types.
    #[must_use]
    pub fn new(strings: Vec<StringDraft>, scene: Option<Scene>) -> Self {
        Self {
            strings,
            scene,
            types: Types::default(),
        }
    }
}

/// One layout version.
#[derive(Debug, Clone, PartialEq)]
pub struct Version {
    pub applies_from: SystemTime,
    pub strings: Vec<PvString>,
    /// Its modules name their string by id.
    pub scene: Option<Scene>,
    pub types: Types,
}

impl Version {
    /// The ids of the strings that share their MPPT input, by inverter device: their
    /// `pv.string.power` is estimated, not measured (ADR 17).
    #[must_use]
    pub fn estimated(&self) -> BTreeMap<u32, Vec<u32>> {
        let mut estimated: BTreeMap<u32, Vec<u32>> = BTreeMap::new();
        for string in &self.strings {
            let w = &string.wiring;
            let shared = self.strings.iter().any(|s| {
                s.id != string.id && s.wiring.device == w.device && s.wiring.input == w.input
            });
            if shared {
                estimated.entry(w.device).or_default().push(string.id);
            }
        }
        estimated
    }
}

/// A string whose open-circuit voltage in the cold exceeds its inverter's maximum DC input
/// voltage: saved all the same, since the plant may already exist (ADR 20).
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Warning {
    pub string: u32,
    /// Volts at −10 °C.
    pub open_circuit_voltage: f64,
    /// Volts, from the inverter's profile.
    pub max_input_voltage: f64,
}

/// The version in force at `at`; `versions` in the order [`Layouts::versions`] returns.
#[must_use]
pub fn in_force(versions: &[Version], at: SystemTime) -> Option<&Version> {
    versions.iter().rev().find(|v| v.applies_from <= at)
}

/// The layout feature module; clones share one.
#[derive(Debug, Clone)]
pub struct Layouts {
    database: Database,
    inverters: Inverters,
    changed: Arc<watch::Sender<()>>,
    shading: Arc<Mutex<pv::ShadingTable>>,
}

impl Layouts {
    #[must_use]
    pub fn new(database: Database, inverters: Inverters) -> Self {
        Self {
            database,
            inverters,
            changed: Arc::new(watch::channel(()).0),
            shading: Arc::default(),
        }
    }

    /// The shading table every run of the model shares (ADR 17): traced again only for a scene
    /// other than the last one run.
    #[must_use]
    pub fn shading(&self) -> Arc<Mutex<pv::ShadingTable>> {
        Arc::clone(&self.shading)
    }

    /// Marked changed by each layout change.
    #[must_use]
    pub fn changes(&self) -> watch::Receiver<()> {
        self.changed.subscribe()
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
    pub async fn add_module_type(&self, datasheet: Datasheet) -> Result<ModuleType, Refused> {
        if let Some(field) = datasheet.unphysical() {
            return Err(Refusal::Value {
                string: None,
                field,
            }
            .into());
        }
        let stored = datasheet.clone();
        let id = self
            .database
            .run(move |db| insert_module_type(db, &stored))
            .await
            .map_err(internal)?;
        Ok(ModuleType { id, datasheet })
    }

    /// Stores a version applying from `applies_from`, in place of one from the same instant, unless
    /// it equals the version in force then; new strings get fresh ids.
    ///
    /// # Errors
    /// A string names an unknown inverter, MPPT input, string id or module type, or a value is
    /// out of range, or the file cannot be written.
    pub async fn change(
        &self,
        applies_from: SystemTime,
        draft: Draft,
        changed: SystemTime,
    ) -> Result<Version, Refused> {
        let Draft {
            mut strings,
            scene,
            types,
        } = draft;
        if let Some(pointer) = types.unphysical() {
            return Err(Refused {
                problem: VALUE,
                pointer: Some(pointer),
                series: None,
            });
        }
        let module_types = self.module_types().await.map_err(internal)?;
        // Saved with places, whatever it came with (ADR 20).
        let scene = scene.map(|scene| scene.settled(scene::sizes(&module_types)));
        if let Some(scene) = &scene {
            scene::derive(scene, &mut strings, &module_types).map_err(Problem::from)?;
        }
        for (at, draft) in strings.iter().enumerate() {
            self.check(at, &draft.wiring, &types)?;
        }
        let draft = Draft {
            strings,
            scene,
            types,
        };
        let stored = self
            .database
            .run(move |db| insert_version(db, applies_from, draft, changed))
            .await
            .map_err(internal)??;
        let (version, stored) = stored;
        if stored {
            self.changed.send_replace(());
        }
        Ok(version)
    }

    /// Each string of `version` whose open-circuit voltage at −10 °C exceeds its inverter's
    /// maximum DC input voltage (ADR 20), from its inverter type or else its profile (ADR 27).
    ///
    /// # Errors
    /// The file cannot be read.
    pub async fn warnings(&self, version: &Version) -> Result<Vec<Warning>, Error> {
        let module_types = self.module_types().await?;
        Ok(version
            .strings
            .iter()
            .filter_map(|string| {
                let w = &string.wiring;
                let module = module_types.iter().find(|m| m.id == w.module_type)?;
                let limits = self
                    .inverters
                    .limits(DeviceId(w.device), Some(&version.types))?;
                let limit = limits.max_input_voltage;
                let voltage =
                    pv::open_circuit_voltage(&module.datasheet.model(), w.modules, pv::COLD);
                (voltage > limit).then_some(Warning {
                    string: string.id,
                    open_circuit_voltage: voltage,
                    max_input_voltage: limit,
                })
            })
            .collect())
    }

    /// Refuses the wiring of the string at position `at`, its inputs read from its inverter's
    /// type in `types` or else its profile.
    fn check(&self, at: usize, wiring: &Wiring, types: &Types) -> Result<(), Refusal> {
        let device = DeviceId(wiring.device);
        if self.inverters.profile(device).is_none() {
            return Err(Refusal::Device);
        }
        // Without declared inputs (ADR 5) any input is taken and nothing is capped.
        let inputs = self
            .inverters
            .limits(device, Some(types))
            .map_or(usize::MAX, |l| l.inputs.len());
        let input = usize::try_from(wiring.input).unwrap_or(usize::MAX);
        if input == 0 || input > inputs {
            return Err(Refusal::Input);
        }
        let ranges = [
            ("modules", wiring.modules > 0),
            ("optimized", wiring.optimized <= wiring.modules),
            ("tilt", (0.0..=90.0).contains(&wiring.tilt)),
            ("azimuth", (-180.0..=180.0).contains(&wiring.azimuth)),
            ("loss", (0.0..100.0).contains(&wiring.loss)),
        ];
        match ranges.into_iter().find(|(_, within)| !within) {
            Some((field, _)) => Err(Refusal::Value {
                string: Some(at),
                field,
            }),
            None => Ok(()),
        }
    }

    /// The module type and layout routes; viewers read them (ADR 20).
    pub fn routes(self, clock: Clock) -> OpenApiRouter {
        OpenApiRouter::new()
            .routes(routes!(list_module_types, add_module_type))
            .routes(routes!(module_catalogue))
            .routes(routes!(layout, change_layout))
            .with_state((self, clock))
    }
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

/// Stores a version, issuing ids to new strings, in place of the one applying from the same
/// instant; refuses an unknown string or module type. A version equal to the one in force then is
/// not stored: that one returns, with `false`.
fn insert_version(
    db: &Connection,
    applies_from: SystemTime,
    draft: Draft,
    changed: SystemTime,
) -> rusqlite::Result<Result<(Version, bool), Refusal>> {
    let Draft {
        strings: drafts,
        scene,
        types,
    } = draft;
    let tx = db.unchecked_transaction()?;
    let strings = match issue(&tx, drafts)? {
        Ok(strings) => strings,
        Err(refusal) => return Ok(Err(refusal)),
    };
    // The drafts' positions become the strings' ids.
    let scene = scene.map(|scene| {
        scene::renumber(&scene, |at| {
            let at = usize::try_from(at).ok()?;
            strings.get(at).map(|s| s.id)
        })
    });
    let versions = read_versions(&tx)?;
    if let Some(current) = in_force(&versions, applies_from)
        && same(current, &strings, scene.as_ref())
        && current.types == types
    {
        return Ok(Ok((current.clone(), false)));
    }
    let version = Version {
        applies_from: time(seconds(applies_from)),
        strings,
        scene,
        types,
    };
    write_version(&tx, &version, changed)?;
    tx.commit()?;
    Ok(Ok((version, true)))
}

/// The drafts as strings, new ones with fresh ids; refuses an unknown string or module type.
fn issue(
    db: &Connection,
    drafts: Vec<StringDraft>,
) -> rusqlite::Result<Result<Vec<PvString>, Refusal>> {
    let mut strings: Vec<PvString> = Vec::with_capacity(drafts.len());
    for draft in drafts {
        let id = match string_id(db, draft.id, &strings)? {
            Ok(id) => id,
            Err(refusal) => return Ok(Err(refusal)),
        };
        let module = db
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
    Ok(Ok(strings))
}

/// Writes `version` in place of the one from its instant, with its change log entry.
fn write_version(db: &Connection, version: &Version, changed: SystemTime) -> rusqlite::Result<()> {
    let (layout, action) = replace_layout(db, version.applies_from, changed)?;
    for s in &version.strings {
        insert_string(db, layout, s)?;
    }
    if let Some(scene) = &version.scene {
        let json = serde_json::to_string(scene)
            .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
        db.execute(
            "INSERT INTO layout_scene (layout, scene) VALUES (?1, ?2)",
            params![layout, json],
        )?;
    }
    if !version.types.is_empty() {
        let json = serde_json::to_string(&version.types)
            .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
        db.execute(
            "INSERT INTO layout_types (layout, types) VALUES (?1, ?2)",
            params![layout, json],
        )?;
    }
    let modules: u32 = version
        .strings
        .iter()
        .map(|s| u32::from(s.wiring.modules))
        .sum();
    let entry = Entry {
        subject: Subject::Layout,
        id: u32::try_from(layout).unwrap_or(u32::MAX),
        action,
        state: Some(serde_json::json!({ "strings": version.strings.len(), "modules": modules })),
        actor: ACTOR,
        changed,
        applies_from: version.applies_from,
    };
    changes::append(db, &entry)
}

/// Degrees within which a derived plane is the same: a scene's planes may differ in their last
/// bits from those an older build derived.
const ROUNDING: f64 = 1e-9;

/// Whether `version` has these strings, in any order, and this scene.
fn same(version: &Version, strings: &[PvString], scene: Option<&Scene>) -> bool {
    let by_id = |strings: &[PvString]| {
        let mut sorted = strings.to_vec();
        sorted.sort_by_key(|s| s.id);
        sorted
    };
    let close = |a: f64, b: f64| (a - b).abs() < ROUNDING;
    let alike = |a: &PvString, b: &PvString| {
        let (x, y) = (&a.wiring, &b.wiring);
        a.id == b.id
            && close(x.tilt, y.tilt)
            && close(x.azimuth, y.azimuth)
            && Wiring {
                tilt: y.tilt,
                azimuth: y.azimuth,
                ..x.clone()
            } == *y
    };
    version.scene.as_ref() == scene
        && version.strings.len() == strings.len()
        && by_id(&version.strings)
            .iter()
            .zip(&by_id(strings))
            .all(|(a, b)| alike(a, b))
}

/// The version applying from `applies_from`, emptied of its strings and scene, or a new one.
fn replace_layout(
    db: &Connection,
    applies_from: SystemTime,
    changed: SystemTime,
) -> rusqlite::Result<(i64, Action)> {
    let existing: Option<i64> = db
        .query_row(
            "SELECT id FROM layout WHERE applies_from = ?1",
            [seconds(applies_from)],
            |row| row.get(0),
        )
        .optional()?;
    let Some(layout) = existing else {
        db.execute(
            "INSERT INTO layout (applies_from, changed, actor) VALUES (?1, ?2, ?3)",
            params![seconds(applies_from), seconds(changed), ACTOR],
        )?;
        return Ok((db.last_insert_rowid(), Action::Add));
    };
    db.execute(
        "UPDATE layout SET changed = ?2, actor = ?3 WHERE id = ?1",
        params![layout, seconds(changed), ACTOR],
    )?;
    db.execute("DELETE FROM layout_string WHERE layout = ?1", [layout])?;
    db.execute("DELETE FROM layout_scene WHERE layout = ?1", [layout])?;
    db.execute("DELETE FROM layout_types WHERE layout = ?1", [layout])?;
    Ok((layout, Action::Change))
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

/// Every version, each scene's modules at their places: one stored with rows and columns reads
/// with each module at its cell's corner (ADR 20).
fn read_versions(db: &Connection) -> rusqlite::Result<Vec<Version>> {
    let module_types = read_module_types(db)?;
    let mut versions = read_stored(db)?;
    for scene in versions.iter_mut().filter_map(|v| v.scene.as_mut()) {
        *scene = scene.settled(scene::sizes(&module_types));
    }
    Ok(versions)
}

fn read_stored(db: &Connection) -> rusqlite::Result<Vec<Version>> {
    let mut strings = db.prepare(
        "SELECT string, name, module_type, device, input, modules, optimized, tilt, azimuth, loss
         FROM layout_string WHERE layout = ?1 ORDER BY string",
    )?;
    let layouts: Vec<(i64, i64, Option<String>, Option<String>)> = db
        .prepare(
            "SELECT id, applies_from, scene, types FROM layout
             LEFT JOIN layout_scene ON layout_scene.layout = id
             LEFT JOIN layout_types ON layout_types.layout = id
             ORDER BY applies_from, id",
        )?
        .query_map([], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
        })?
        .collect::<rusqlite::Result<_>>()?;
    layouts
        .into_iter()
        .map(|(id, applies_from, scene, types)| {
            let scene = parsed(scene, 2)?;
            let types = parsed(types, 3)?.unwrap_or_default();
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
                scene,
                types,
            })
        })
        .collect()
}

/// A stored JSON column read as `T`.
fn parsed<T: serde::de::DeserializeOwned>(
    json: Option<String>,
    column: usize,
) -> rusqlite::Result<Option<T>> {
    json.map(|json| serde_json::from_str(&json))
        .transpose()
        .map_err(|e| {
            rusqlite::Error::FromSqlConversionFailure(
                column,
                rusqlite::types::Type::Text,
                Box::new(e),
            )
        })
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
    let module_types = layouts.module_types().await.map_err(internal)?;
    Ok(Json(ModuleTypes { module_types }))
}

/// The module catalogue's sheets, as the admin picks a datasheet to add as a module type.
#[derive(Serialize, ToSchema)]
struct ModuleCatalogue {
    sheets: Vec<sunreye_catalogue::Sheet>,
}

#[utoipa::path(get, path = "/api/v1/module-catalogue", responses(
    (status = 200, body = ModuleCatalogue),
    (status = "4XX", body = ProblemDetails, content_type = "application/problem+json"),
))]
async fn module_catalogue() -> Result<Json<ModuleCatalogue>, Problem> {
    let sheets = catalogue::bundled().map_err(internal)?;
    Ok(Json(ModuleCatalogue { sheets }))
}

/// Adds a module type from its datasheet, entered or copied from the module catalogue.
#[utoipa::path(post, path = "/api/v1/module-types", request_body = Datasheet, responses(
    (status = 201, body = ModuleType),
    (status = "4XX", body = ProblemDetails, content_type = "application/problem+json"),
))]
async fn add_module_type(
    State((layouts, _)): LayoutState,
    body: Result<Json<Datasheet>, JsonRejection>,
) -> Result<(StatusCode, Json<ModuleType>), Refused> {
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
    /// Its modules name their string by position in `strings`.
    #[serde(skip_serializing_if = "Option::is_none")]
    scene: Option<Scene>,
    #[serde(flatten)]
    types: Types,
    warnings: Vec<Warning>,
}

impl Layout {
    fn new(version: &Version, warnings: Vec<Warning>) -> Self {
        let position = |id| {
            let at = version.strings.iter().position(|s: &PvString| s.id == id)?;
            u32::try_from(at).ok()
        };
        Self {
            applies_from: jiff::Timestamp::try_from(version.applies_from)
                .map(|t| t.to_string())
                .unwrap_or_default(),
            strings: version.strings.clone(),
            scene: version
                .scene
                .as_ref()
                .map(|scene| scene::renumber(scene, position)),
            types: version.types.clone(),
            warnings,
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
    let versions = layouts.versions().await.map_err(internal)?;
    let version = in_force(&versions, at).ok_or(NONE)?;
    let warnings = layouts.warnings(version).await.map_err(internal)?;
    Ok(Json(Layout::new(version, warnings)))
}

/// A layout change: every string, applying from an instant on. A member this core does not know
/// is refused, not dropped (ADR 25).
#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LayoutChange {
    /// RFC 3339.
    applies_from: String,
    strings: Vec<StringDraft>,
    /// Its modules name their string by position in `strings`; it decides their module counts
    /// and planes.
    scene: Option<Scene>,
    /// By inverter device: read before its profile (ADR 27).
    #[serde(default)]
    inverter_types: BTreeMap<u32, pv::InverterType>,
    /// By battery device.
    #[serde(default)]
    battery_types: BTreeMap<u32, pv::BatteryType>,
}

/// Changes the layout from an instant on; new strings get fresh ids.
#[utoipa::path(put, path = "/api/v1/layout", request_body = LayoutChange, responses(
    (status = 200, body = Layout),
    (status = "4XX", body = ProblemDetails, content_type = "application/problem+json"),
))]
async fn change_layout(
    State((layouts, clock)): LayoutState,
    body: Result<Json<LayoutChange>, JsonRejection>,
) -> Result<Json<Layout>, Refused> {
    let Json(change) = body.map_err(|_| BODY)?;
    let applies_from = instant(&change.applies_from).map_err(|_| BODY)?;
    let draft = Draft {
        strings: change.strings,
        scene: change.scene,
        types: Types {
            inverter_types: change.inverter_types,
            battery_types: change.battery_types,
        },
    };
    let version = layouts.change(applies_from, draft, clock()).await?;
    let warnings = layouts.warnings(&version).await.map_err(internal)?;
    Ok(Json(Layout::new(&version, warnings)))
}

fn instant(text: &str) -> Result<SystemTime, Problem> {
    let instant: jiff::Timestamp = text.parse().map_err(|_| QUERY)?;
    Ok(instant.into())
}
