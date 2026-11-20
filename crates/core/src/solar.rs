//! The solar forecast (ADR 15, 17).
//!
//! The `pv` model runs over the stored weather forecast and the layout in force at each target;
//! each MPPT input's learned correction scales it and its strings at the plant-local month and
//! hour, and the results are stored as forecasts of each inverter's `pv.string.power`, `pv.mppt.power` and
//! `pv.power`.

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use sunreye_pv as pv;
use tokio::sync::watch;

use crate::bus::{Bus, DeviceId};
use crate::correction::{Grid, Grids, plant_hour};
use crate::layout::{Inverters, Layouts, PvString, Version, in_force};
use crate::location::Location;
use crate::storage::{self, Issue, Keep, Storage};

const HOUR: Duration = Duration::from_hours(1);
/// Today and two more days, as the weather device fetches (ADR 17).
const HORIZON: Duration = Duration::from_hours(72);
/// Watts: the step of a series no profile stores.
const STEP: f64 = 1.0;
const WEATHER: [&str; 5] = [
    "weather.ghi",
    "weather.dni",
    "weather.dhi",
    "weather.temperature",
    "weather.wind",
];

/// A stored series: the inverter, the role and its index.
pub(crate) type Key = (DeviceId, &'static str, Option<u32>);

/// The solar forecast. It reads the weather device's forecasts, never a provider.
pub struct SolarForecast {
    layouts: Layouts,
    weather: DeviceId,
    bus: Bus,
}

impl SolarForecast {
    /// Forecasts from the weather device `weather`'s forecasts.
    #[must_use]
    pub fn new(layouts: Layouts, weather: DeviceId, bus: &Bus) -> Self {
        Self {
            layouts,
            weather,
            bus: bus.clone(),
        }
    }

    /// Issues a forecast on start, after each weather forecast announced on `weather` and after
    /// each layout change, while the plant's `location` is set, until storage or the weather
    /// device stops, with the grids from `corrections`. `clock` gives each issue's time.
    pub async fn run(
        &self,
        (storage, corrections): (&Storage, &impl Grids),
        location: watch::Receiver<Option<Location>>,
        mut weather: watch::Receiver<Option<SystemTime>>,
        clock: impl Fn() -> SystemTime + Sync,
    ) {
        let mut layout = self.layouts.changes();
        loop {
            let current = *location.borrow();
            let refreshed = match current {
                Some(at) => self.refresh(storage, corrections, at, clock()).await,
                None => Ok(()),
            };
            match refreshed {
                Err(storage::Error::Stopped) => return,
                Err(e) => tracing::warn!("solar forecast: {e}"),
                Ok(()) => {}
            }
            tokio::select! {
                changed = weather.changed() => {
                    if changed.is_err() {
                        return;
                    }
                }
                // The layout module outlives this task.
                _ = layout.changed() => {}
            }
        }
    }

    /// Issues a forecast at `issued` for the plant at `location`, for every weather target from the start of its hour on,
    /// with each MPPT input's grid from `corrections` applied.
    /// Every string, input and inverter any layout version has is issued, 0 W where the version
    /// in force at a target lacks it, so a removed string's earlier issue is superseded.
    /// A series storage refuses is logged and skipped.
    ///
    /// # Errors
    /// Storage stopped, or the weather, layouts or corrections could not be read.
    pub async fn refresh(
        &self,
        storage: &Storage,
        corrections: &impl Grids,
        location: Location,
        issued: SystemTime,
    ) -> Result<(), storage::Error> {
        let from = hour_of(issued);
        let weather = self.weather(storage, from, from + HORIZON).await?;
        let versions = self.layouts.versions().await?;
        let mut series: BTreeMap<Key, Vec<(SystemTime, f64)>> = versions
            .iter()
            .flat_map(|v| &v.strings)
            .flat_map(|s| keys(s).map(|key| (key, Vec::new())))
            .collect();
        let inputs: HashSet<_> = versions
            .iter()
            .flat_map(|v| &v.strings)
            .map(input_of)
            .collect();
        let mut grids = HashMap::new();
        for input in inputs {
            grids.insert(input, corrections.grid(input.0, input.1).await?);
        }
        let zone = storage.zones().now();
        let inverters = self.layouts.inverters();
        let rating = |device| {
            let profile = inverters.profile(device)?;
            profile.inverter()?.ac_rating
        };
        for (target, modelled) in estimates(&self.layouts, &versions, location, weather).await? {
            let (month, hour) = plant_hour(target, &zone);
            let factor = |input| {
                grids
                    .get(&input)
                    .map_or(1.0, |g: &Grid| g.factor(month, hour))
            };
            let values = corrected(modelled, in_force(&versions, target), factor, rating);
            for (key, points) in &mut series {
                points.push((target, values.get(key).copied().unwrap_or(0.0)));
            }
        }
        self.store(storage, issued, series).await
    }

    /// Stores each series' issue at `issued`, in the step its profile stores the series in. A
    /// series storage refuses, such as one stored in another step, loses its issue alone.
    async fn store(
        &self,
        storage: &Storage,
        issued: SystemTime,
        series: BTreeMap<Key, Vec<(SystemTime, f64)>>,
    ) -> Result<(), storage::Error> {
        let inverters = self.layouts.inverters();
        for ((device, role, index), values) in series {
            let issue = Issue {
                issued,
                step: step(inverters, (device, role, index)),
                values,
                keep: Keep::Ahead,
            };
            match storage
                .forecast(device, self.bus.intern(role, index), issue)
                .await
            {
                Ok(()) => {}
                Err(storage::Error::Stopped) => return Err(storage::Error::Stopped),
                Err(e) => tracing::warn!(device = device.0, role, ?index, "not forecast: {e}"),
            }
        }
        Ok(())
    }

    /// The latest weather forecast of each target from `from` to before `to` that has
    /// irradiance and temperature.
    async fn weather(
        &self,
        storage: &Storage,
        from: SystemTime,
        to: SystemTime,
    ) -> Result<Vec<(SystemTime, pv::Weather)>, storage::Error> {
        let mut latest: HashMap<(SystemTime, usize), f64> = HashMap::new();
        for (i, role) in WEATHER.iter().enumerate() {
            let series = self.bus.intern(role, None);
            // By target, then issue: the last of a target is its latest.
            for f in storage.forecasts(self.weather, series, from, to).await? {
                latest.insert((f.target, i), f.value);
            }
        }
        let targets: BTreeSet<SystemTime> = latest.keys().map(|(target, _)| *target).collect();
        Ok(targets
            .into_iter()
            .filter_map(|target| {
                let value = |i| latest.get(&(target, i)).copied();
                let since = target.duration_since(UNIX_EPOCH).ok()?;
                let weather = pv::Weather {
                    unix: i64::try_from(since.as_secs()).ok()?,
                    ghi: value(0)?,
                    dni: value(1)?,
                    dhi: value(2)?,
                    temperature: value(3)?,
                    wind: value(4),
                };
                Some((target, weather))
            })
            .collect())
    }
}

/// The model's value of each series at each weather target, under the layout of `versions` in
/// force there; none for a target without one.
///
/// # Errors
/// Storage failed.
pub(crate) async fn estimates(
    layouts: &Layouts,
    versions: &[Version],
    location: Location,
    weather: Vec<(SystemTime, pv::Weather)>,
) -> Result<Vec<(SystemTime, HashMap<Key, f64>)>, storage::Error> {
    let module_types: HashMap<u32, pv::ModuleType> = layouts
        .module_types()
        .await?
        .into_iter()
        .map(|m| (m.id, m.datasheet.model()))
        .collect();
    let versions = versions.to_vec();
    let inverters = layouts.inverters().clone();
    // Seconds of work on a slow device: on tokio's blocking pool, the I/O thread stays free (ADR 2).
    tokio::task::spawn_blocking(move || {
        weather
            .into_iter()
            .map(|(target, sky)| {
                let values = in_force(&versions, target).map_or_else(HashMap::new, |version| {
                    let model = Model::new(version, &module_types, &inverters, location);
                    model.values(&pv::estimate(&model.layout, &sky))
                });
                (target, values)
            })
            .collect()
    })
    .await
    // A panic in the model stays one, as it would have been on the I/O thread; only a runtime
    // shutting down cancels it.
    .map_err(|e| {
        e.try_into_panic().map_or(storage::Error::Stopped, |panic| {
            std::panic::resume_unwind(panic)
        })
    })
}

/// The start of `time`'s hour, in whole seconds: a sub-second left on it would skip the hour's
/// first target.
fn hour_of(time: SystemTime) -> SystemTime {
    let since = time
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    UNIX_EPOCH + Duration::from_secs(since - since % HOUR.as_secs())
}

/// A string's inverter device and MPPT input.
const fn input_of(string: &PvString) -> (DeviceId, u32) {
    (DeviceId(string.wiring.device), string.wiring.input)
}

/// The model's values with each MPPT input's learned `factor` applied to it and to its strings
/// (ADR 17); each inverter's `pv.power` is the sum of its corrected inputs, capped at its AC
/// `rating` when its profile declares one. A capped inverter's inputs and strings are scaled
/// with it, so they still sum to it.
fn corrected(
    mut values: HashMap<Key, f64>,
    version: Option<&Version>,
    factor: impl Fn((DeviceId, u32)) -> f64,
    rating: impl Fn(DeviceId) -> Option<f64>,
) -> HashMap<Key, f64> {
    let inputs: HashMap<u32, (DeviceId, u32)> = version
        .map(|v| v.strings.iter().map(|s| (s.id, input_of(s))).collect())
        .unwrap_or_default();
    let mut inverters: HashMap<DeviceId, f64> = HashMap::new();
    for ((device, role, index), value) in &mut values {
        let input = match (*role, *index) {
            ("pv.mppt.power", Some(n)) => (*device, n),
            ("pv.string.power", Some(id)) => match inputs.get(&id) {
                Some(input) => *input,
                None => continue,
            },
            _ => continue,
        };
        *value *= factor(input);
        if *role == "pv.mppt.power" {
            *inverters.entry(*device).or_default() += *value;
        }
    }
    // What each inverter over its rating keeps of its inputs and strings.
    let kept: HashMap<DeviceId, f64> = inverters
        .iter()
        .filter_map(|(device, power)| {
            let cap = rating(*device).filter(|cap| power > cap)?;
            Some((*device, cap / power))
        })
        .collect();
    for ((device, _, _), value) in &mut values {
        *value *= kept.get(device).copied().unwrap_or(1.0);
    }
    for (device, power) in inverters {
        let kept = kept.get(&device).copied().unwrap_or(1.0);
        values.insert((device, "pv.power", None), power * kept);
    }
    values
}

/// The step the inverter's profile stores `key` in, which its forecast shares (ADR 3, 17); 1 W
/// where the profile has no such quantity, such as `pv.string.power`.
fn step(inverters: &Inverters, (device, role, index): Key) -> f64 {
    inverters
        .profile(device)
        .and_then(|p| {
            p.quantities()
                .iter()
                .find(|q| q.role == role && q.index == index)
                .map(sunreye_profile::Quantity::step)
        })
        .unwrap_or(STEP)
}

/// The series a string contributes to.
fn keys(string: &PvString) -> impl Iterator<Item = Key> {
    let w = &string.wiring;
    let device = DeviceId(w.device);
    [
        (device, "pv.string.power", Some(string.id)),
        (device, "pv.mppt.power", Some(w.input)),
        (device, "pv.power", None),
    ]
    .into_iter()
}

/// A layout version as the `pv` model takes it, with the series of each place in it.
struct Model {
    layout: pv::Layout,
    places: Vec<InverterPlace>,
}

/// Where an estimated inverter's values are stored.
struct InverterPlace {
    device: DeviceId,
    inputs: Vec<InputPlace>,
}

struct InputPlace {
    /// The `pv.mppt.*` index.
    index: u32,
    /// The ids of its strings, in the model's order.
    strings: Vec<u32>,
}

/// The scene's modules by string id.
type Placed = HashMap<u32, Vec<pv::Module>>;

/// A version's strings by inverter device, then MPPT input.
type Wired<'a> = BTreeMap<u32, BTreeMap<u32, Vec<&'a PvString>>>;

impl Model {
    fn new(
        version: &Version,
        module_types: &HashMap<u32, pv::ModuleType>,
        inverters: &Inverters,
        location: Location,
    ) -> Self {
        let (by_string, occluders) = scene(version, module_types);
        let mut wired: Wired<'_> = BTreeMap::new();
        for string in &version.strings {
            let w = &string.wiring;
            let input = wired
                .entry(w.device)
                .or_default()
                .entry(w.input)
                .or_default();
            input.push(string);
        }
        let (inverters, places) = wired
            .into_iter()
            .map(|(device, inputs)| {
                let profile = inverters.profile(DeviceId(device));
                let section = profile.as_deref().and_then(|p| p.inverter());
                let declared = section.map(|i| i.mppt.as_slice()).unwrap_or_default();
                let (inputs, places) = inputs
                    .into_iter()
                    .map(|(index, strings)| {
                        input(index, &strings, declared, module_types, &by_string)
                    })
                    .unzip();
                let inverter = pv::Inverter { inputs };
                let place = InverterPlace {
                    device: DeviceId(device),
                    inputs: places,
                };
                (inverter, place)
            })
            .unzip();
        let location = pv::Location {
            latitude: location.latitude,
            longitude: location.longitude,
        };
        Self {
            layout: pv::Layout {
                location,
                inverters,
                occluders,
            },
            places,
        }
    }

    /// The estimate's value of each series.
    fn values(&self, estimate: &pv::Estimate) -> HashMap<Key, f64> {
        let mut values = HashMap::new();
        for (place, inverter) in self.places.iter().zip(&estimate.inverters) {
            values.insert((place.device, "pv.power", None), inverter.power);
            for (input, modelled) in place.inputs.iter().zip(&inverter.inputs) {
                let key = (place.device, "pv.mppt.power", Some(input.index));
                values.insert(key, modelled.power);
                let strings = input.strings.iter().zip(&modelled.strings);
                values.extend(
                    strings
                        .map(|(id, power)| ((place.device, "pv.string.power", Some(*id)), *power)),
                );
            }
        }
        values
    }
}

/// The modules the version's scene places, by string id, and what shades them.
fn scene(
    version: &Version,
    module_types: &HashMap<u32, pv::ModuleType>,
) -> (Placed, Vec<pv::Occluder>) {
    let Some(scene) = &version.scene else {
        return (HashMap::new(), Vec::new());
    };
    let size = |id| {
        let m: &pv::ModuleType = module_types.get(&id)?;
        Some(pv::Size {
            width: m.width,
            height: m.height,
        })
    };
    let mut by_string: Placed = HashMap::new();
    // Saving checked the scene, so it places every module.
    for placed in scene.modules(size).unwrap_or_default() {
        if let Some(id) = placed.string {
            by_string.entry(id).or_default().push(placed.module);
        }
    }
    (by_string, scene.occluders())
}

/// One MPPT input of the model, with its limits from the profile (ADR 5), and its place.
fn input(
    index: u32,
    strings: &[&PvString],
    declared: &[sunreye_profile::Mppt],
    module_types: &HashMap<u32, pv::ModuleType>,
    placed: &Placed,
) -> (pv::Input, InputPlace) {
    let limits = usize::try_from(index)
        .ok()
        .and_then(|n| declared.get(n.checked_sub(1)?))
        .map(|m| pv::MpptLimits {
            max_current: m.max_current,
            min_voltage: m.min_voltage,
            max_voltage: m.max_voltage,
            start_voltage: m.start_voltage,
        });
    let modelled: Vec<(u32, pv::PvString)> = strings
        .iter()
        .filter_map(|s| {
            Some((
                s.id,
                string(s, *module_types.get(&s.wiring.module_type)?, placed),
            ))
        })
        .collect();
    let place = InputPlace {
        index,
        strings: modelled.iter().map(|(id, _)| *id).collect(),
    };
    let input = pv::Input {
        limits,
        strings: modelled.into_iter().map(|(_, s)| s).collect(),
    };
    (input, place)
}

/// A string with its modules where the scene places them (ADR 20); entered by form, on one
/// plane with a count of optimized modules (ADR 17).
fn string(string: &PvString, module: pv::ModuleType, placed: &Placed) -> pv::PvString {
    let w = &string.wiring;
    if let Some(modules) = placed.get(&string.id) {
        return pv::PvString {
            module,
            modules: modules.clone(),
            loss: w.loss,
        };
    }
    let plane = pv::Plane {
        tilt: w.tilt,
        azimuth: w.azimuth,
    };
    pv::PvString::on_one_plane(module, plane, w.modules, w.optimized, w.loss)
}

#[cfg(test)]
mod tests;
