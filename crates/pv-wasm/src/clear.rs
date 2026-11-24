//! A clear-sky run of a layout in the browser (ADR 20), for dates without weather, and the plant
//! both it and a year's run read. A clear-sky run caps no input: MPPT limits are the inverter
//! profile's, which the browser does not read.

use std::collections::{BTreeMap, HashMap};

use serde::Deserialize;
use sunreye_pv::{
    Input, Inverter, InverterType, Layout, Module, ModuleType, Neighbour, NeighbourRefused, Plane,
    PvString, Scene, Size, clear_weather, estimate,
};

use crate::Place;

/// A module type's datasheet, as the core's API names it.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Datasheet {
    pub id: u32,
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
    pub const fn model(&self) -> ModuleType {
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
pub struct Wiring {
    pub module_type: u32,
    pub device: u32,
    pub input: u32,
    pub modules: u16,
    optimized: u16,
    tilt: f64,
    azimuth: f64,
    loss: f64,
}

/// The scene names its strings by position in `strings`; the builder's consumer may stand neighbours
/// around it, which shade as its obstacles do (ADR 20).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Plant {
    location: Place,
    scene: Scene,
    #[serde(default)]
    neighbours: Vec<Neighbour>,
    module_types: Vec<Datasheet>,
    pub strings: Vec<Wiring>,
}

/// A plant under a clear sky at each of `times`.
#[derive(Deserialize)]
pub struct Run {
    #[serde(flatten)]
    plant: Plant,
    times: Vec<i64>,
}

impl Run {
    /// By time, then string position; 0 W for a string of an unknown module type.
    ///
    /// # Errors
    /// A supplied neighbour's [`NeighbourRefused`].
    pub fn watts(&self) -> Result<Vec<Vec<f64>>, NeighbourRefused> {
        let Wired { layout, order, .. } = self.plant.layout(&HashMap::new())?;
        Ok(self
            .times
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
                (0..self.plant.strings.len())
                    .map(|i| by_position.get(&i).copied().unwrap_or(0.0))
                    .collect()
            })
            .collect())
    }
}

/// A plant's model layout and where its parts came from.
pub struct Wired {
    pub layout: Layout,
    /// The string position of each of the layout's strings, in its order.
    pub order: Vec<usize>,
    /// The device id of each of the layout's inverters, and the input number of each of its inputs.
    pub devices: Vec<(u32, Vec<u32>)>,
}

impl Plant {
    /// The model's layout, each inverter's MPPT limits and AC side from its type in `types` by
    /// device id, read whole; strings of an unknown module type are left out.
    ///
    /// # Errors
    /// A supplied neighbour's [`NeighbourRefused`].
    pub fn layout(&self, types: &HashMap<u32, InverterType>) -> Result<Wired, NeighbourRefused> {
        let wired = self.by_input();
        let order = wired
            .values()
            .flat_map(BTreeMap::values)
            .flatten()
            .map(|(i, _)| *i)
            .collect();
        let devices = wired
            .iter()
            .map(|(&device, inputs)| (device, inputs.keys().copied().collect()))
            .collect();
        let inverters = wired
            .into_iter()
            .map(|(device, inputs)| {
                let datasheet = types.get(&device);
                let limits = datasheet.map(InverterType::limits).unwrap_or_default();
                Inverter {
                    inputs: inputs
                        .into_iter()
                        .map(|(input, strings)| Input {
                            limits: usize::try_from(input)
                                .ok()
                                .and_then(|i| i.checked_sub(1))
                                .and_then(|i| limits.get(i))
                                .copied(),
                            strings: strings.into_iter().map(|(_, s)| s).collect(),
                        })
                        .collect(),
                    ac: datasheet.map(InverterType::ac_side),
                }
            })
            .collect();
        let mut occluders = self.scene.occluders();
        occluders.extend(Neighbour::occluders(&self.neighbours)?);
        let layout = Layout {
            location: self.location.into(),
            inverters,
            occluders,
        };
        Ok(Wired {
            layout,
            order,
            devices,
        })
    }

    /// Each string with its position, by inverter, then input.
    fn by_input(&self) -> BTreeMap<u32, BTreeMap<u32, Vec<(usize, PvString)>>> {
        let types: HashMap<u32, ModuleType> = self
            .module_types
            .iter()
            .map(|d| (d.id, d.model()))
            .collect();
        let placed = self.placed(&types);
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
        wired
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
