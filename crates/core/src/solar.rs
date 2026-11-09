//! The solar forecast (ADR 15, 17).
//!
//! The `pv` model runs over the stored weather forecast and the layout in force at each target;
//! its results are stored as forecasts of each inverter's `pv.string.power`, `pv.mppt.power` and
//! `pv.power`.

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use sunreye_pv as pv;

use crate::bus::{Bus, DeviceId};
use crate::layout::{Inverters, Layouts, PvString, Version, in_force};
use crate::storage::{self, Issue, Location, Storage};

const HOUR: Duration = Duration::from_hours(1);
/// Today and two more days, as the weather device fetches (ADR 17).
const HORIZON: Duration = Duration::from_hours(72);
/// Watts.
const STEP: f64 = 1.0;
const WEATHER: [&str; 5] = [
    "weather.ghi",
    "weather.dni",
    "weather.dhi",
    "weather.temperature",
    "weather.wind",
];

/// A stored series: the inverter, the role and its index.
type Key = (DeviceId, &'static str, Option<u32>);

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

    /// Issues a forecast at `issued` for every weather target from the start of its hour on.
    /// Every string, input and inverter any layout version has is issued, 0 W where the version
    /// in force at a target lacks it, so a removed string's earlier issue is superseded.
    ///
    /// # Errors
    /// Storage failed.
    pub async fn refresh(
        &self,
        storage: &Storage,
        issued: SystemTime,
    ) -> Result<(), storage::Error> {
        let Some(location) = storage.location().await? else {
            return Ok(());
        };
        let since = issued.duration_since(UNIX_EPOCH).unwrap_or_default();
        let from = issued - Duration::from_secs(since.as_secs() % HOUR.as_secs());
        let weather = self.weather(storage, from, from + HORIZON).await?;
        let module_types: HashMap<u32, pv::ModuleType> = self
            .layouts
            .module_types()
            .await?
            .into_iter()
            .map(|m| {
                let d = m.datasheet;
                let model = pv::ModuleType {
                    pmax: d.pmax,
                    vmp: d.vmp,
                    power_coefficient: d.power_coefficient,
                    voltage_coefficient: d.voltage_coefficient,
                };
                (m.id, model)
            })
            .collect();
        let versions = self.layouts.versions().await?;
        let mut series: BTreeMap<Key, Vec<(SystemTime, f64)>> = versions
            .iter()
            .flat_map(|v| &v.strings)
            .flat_map(|s| keys(s).map(|key| (key, Vec::new())))
            .collect();
        for (target, sky) in weather {
            let values = in_force(&versions, target).map_or_else(HashMap::new, |version| {
                let model = Model::new(version, &module_types, self.layouts.inverters(), location);
                model.values(&pv::estimate(&model.layout, &sky))
            });
            for (key, points) in &mut series {
                points.push((target, values.get(key).copied().unwrap_or(0.0)));
            }
        }
        for ((device, role, index), values) in series {
            let issue = Issue {
                issued,
                step: STEP,
                values,
            };
            storage
                .forecast(device, self.bus.intern(role, index), issue)
                .await?;
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

/// A version's strings by inverter device, then MPPT input.
type Wired<'a> = BTreeMap<u32, BTreeMap<u32, Vec<&'a PvString>>>;

impl Model {
    fn new(
        version: &Version,
        module_types: &HashMap<u32, pv::ModuleType>,
        inverters: &Inverters,
        location: Location,
    ) -> Self {
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
                let declared = inverters
                    .profile(DeviceId(device))
                    .and_then(|p| p.inverter())
                    .map(|i| i.mppt.as_slice())
                    .unwrap_or_default();
                let (inputs, places) = inputs
                    .into_iter()
                    .map(|(index, strings)| input(index, &strings, declared, module_types))
                    .unzip();
                let inverter = pv::Inverter {
                    ac_rating: None,
                    inputs,
                };
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

/// One MPPT input of the model, with its limits from the profile (ADR 5), and its place.
fn input(
    index: u32,
    strings: &[&PvString],
    declared: &[sunreye_profile::Mppt],
    module_types: &HashMap<u32, pv::ModuleType>,
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
        .filter_map(|s| Some((s.id, string(s, *module_types.get(&s.wiring.module_type)?))))
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

const fn string(string: &PvString, module: pv::ModuleType) -> pv::PvString {
    let w = &string.wiring;
    pv::PvString {
        module,
        modules: w.modules,
        plane: pv::Plane {
            tilt: w.tilt,
            azimuth: w.azimuth,
        },
        loss: w.loss,
    }
}

#[cfg(test)]
mod tests;
