//! A clear-sky run of a layout in the browser (ADR 20), for dates without weather. MPPT limits
//! are the inverter profile's, which the browser does not read, so no input is capped.

use std::collections::{BTreeMap, HashMap};

use serde::Deserialize;
use sunreye_pv::{
    Input, Inverter, Layout, Module, ModuleType, Plane, PvString, Scene, Size, clear_weather,
    estimate,
};

use crate::Place;

/// A module type's datasheet, as the core's API names it.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Datasheet {
    id: u32,
    vmp: f64,
    imp: f64,
    voc: f64,
    isc: f64,
    voltage_coefficient: f64,
    current_coefficient: f64,
    width: f64,
    height: f64,
    bypass_diodes: u8,
}

impl Datasheet {
    const fn model(&self) -> ModuleType {
        ModuleType {
            vmp: self.vmp,
            imp: self.imp,
            voc: self.voc,
            isc: self.isc,
            voltage_coefficient: self.voltage_coefficient,
            current_coefficient: self.current_coefficient,
            width: self.width,
            height: self.height,
            bypass_diodes: self.bypass_diodes,
        }
    }
}

/// A string's wiring, as the core's API names it.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Wiring {
    module_type: u32,
    device: u32,
    input: u32,
    modules: u16,
    optimized: u16,
    tilt: f64,
    azimuth: f64,
    loss: f64,
}

/// The scene names its strings by position in `strings`.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Run {
    location: Place,
    scene: Scene,
    module_types: Vec<Datasheet>,
    strings: Vec<Wiring>,
    times: Vec<i64>,
}

impl Run {
    /// By time, then string position; 0 W for a string of an unknown module type.
    pub fn watts(&self) -> Vec<Vec<f64>> {
        let types: HashMap<u32, ModuleType> = self
            .module_types
            .iter()
            .map(|d| (d.id, d.model()))
            .collect();
        let (layout, order) = self.layout(&types);
        self.times
            .iter()
            .map(|&unix| {
                let estimated = estimate(&layout, &clear_weather(unix, layout.location));
                let shares = estimated
                    .inverters
                    .iter()
                    .flat_map(|inverter| &inverter.inputs)
                    .flat_map(|input| &input.strings);
                let by_position: HashMap<usize, f64> =
                    order.iter().copied().zip(shares.copied()).collect();
                (0..self.strings.len())
                    .map(|i| by_position.get(&i).copied().unwrap_or(0.0))
                    .collect()
            })
            .collect()
    }

    /// The model's layout, and the string position of each of its strings in its order.
    fn layout(&self, types: &HashMap<u32, ModuleType>) -> (Layout, Vec<usize>) {
        let placed = self.placed(types);
        // By inverter, then input.
        let mut wired: BTreeMap<u32, BTreeMap<u32, Vec<(usize, PvString)>>> = BTreeMap::new();
        for (i, w) in self.strings.iter().enumerate() {
            let Some(&module) = types.get(&w.module_type) else {
                continue;
            };
            let painted = u32::try_from(i).ok().and_then(|i| placed.get(&i));
            wired
                .entry(w.device)
                .or_default()
                .entry(w.input)
                .or_default()
                .push((i, string(w, module, painted)));
        }
        let order = wired
            .values()
            .flat_map(BTreeMap::values)
            .flatten()
            .map(|(i, _)| *i)
            .collect();
        let inverters = wired
            .into_values()
            .map(|inputs| Inverter {
                ac_rating: None,
                inputs: inputs
                    .into_values()
                    .map(|strings| Input {
                        limits: None,
                        strings: strings.into_iter().map(|(_, s)| s).collect(),
                    })
                    .collect(),
            })
            .collect();
        let layout = Layout {
            location: self.location.into(),
            inverters,
            occluders: self.scene.occluders(),
        };
        (layout, order)
    }

    /// The scene's modules by string position.
    fn placed(&self, types: &HashMap<u32, ModuleType>) -> HashMap<u32, Vec<Module>> {
        let size = |id| {
            types.get(&id).map(|m| Size {
                width: m.width,
                height: m.height,
            })
        };
        let mut placed: HashMap<u32, Vec<Module>> = HashMap::new();
        for module in self.scene.modules(size).unwrap_or_default() {
            if let Some(string) = module.string {
                placed.entry(string).or_default().push(module.module);
            }
        }
        placed
    }
}

/// A string with its modules where the scene places them; entered by form, on one plane.
fn string(w: &Wiring, module: ModuleType, painted: Option<&Vec<Module>>) -> PvString {
    painted.map_or_else(
        || {
            let plane = Plane {
                tilt: w.tilt,
                azimuth: w.azimuth,
            };
            PvString::on_one_plane(module, plane, w.modules, w.optimized, w.loss)
        },
        |modules| PvString {
            module,
            modules: modules.clone(),
            loss: w.loss,
        },
    )
}
