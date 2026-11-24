//! A plant's run over a year of weather (ADR 17): energy per string, MPPT input and inverter, and
//! a typed inverter's AC side.

use std::collections::HashMap;

use serde::Deserialize;
use serde_json::{Map, Value, json};
use sunreye_pv::{
    AcCable, Cable, Chain, Energy, Horizon, InverterType, InverterYear, RunInputs, Warranty,
    Weather, year_run,
};

use crate::clear::{Plant, TABLE, Wired, horizon};

/// Weather at a fixed step, as columns: sample `i` is at `start + i × step`.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Steps {
    /// Seconds since 1970, UTC.
    start: i64,
    /// Seconds.
    pub step: i64,
    /// W/m².
    ghi: Vec<f64>,
    dni: Vec<f64>,
    dhi: Vec<f64>,
    /// °C.
    temperature: Vec<f64>,
    /// m/s, each null where unknown; absent where the source has none.
    #[serde(default)]
    wind: Option<Vec<Option<f64>>>,
}

impl Steps {
    pub fn samples(&self) -> Result<Vec<Weather>, String> {
        let n = self.ghi.len();
        let lengths = [
            self.dni.len(),
            self.dhi.len(),
            self.temperature.len(),
            self.wind.as_ref().map_or(n, Vec::len),
        ];
        if lengths.iter().any(|&len| len != n) {
            return Err("weather columns differ in length".to_owned());
        }
        if self.step <= 0 {
            return Err("weather step must be positive".to_owned());
        }
        let wind = self
            .wind
            .as_ref()
            .map_or_else(|| vec![None; n], Clone::clone);
        let step = usize::try_from(self.step).unwrap_or(1);
        Ok((self.start..)
            .step_by(step)
            .zip(&self.ghi)
            .zip(&self.dni)
            .zip(&self.dhi)
            .zip(&self.temperature)
            .zip(wind)
            .map(
                |(((((unix, &ghi), &dni), &dhi), &temperature), wind)| Weather {
                    unix,
                    ghi,
                    dni,
                    dhi,
                    temperature,
                    wind,
                },
            )
            .collect())
    }
}

/// A plant, its inverters' types by device id, and a year of weather.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct YearRun {
    #[serde(flatten)]
    plant: Plant,
    /// Each inverter's MPPT limits and AC side come from its type; without one, nothing is capped
    /// and no AC side is reported.
    #[serde(default)]
    inverter_types: HashMap<u32, InverterType>,
    weather: Steps,
    /// The far horizon the caller supplies; never part of the plant (ADR 17).
    #[serde(default)]
    horizon: Option<Vec<[f64; 2]>>,
    /// Of the light reaching the cells, in %.
    #[serde(default)]
    soiling: Option<f64>,
    #[serde(default)]
    cables: Cables,
    /// Gives each year's yield from the plant's chain's end.
    #[serde(default)]
    warranty: Option<Lifetime>,
}

/// The cables the caller supplies a run; never part of the plant (ADR 17).
#[derive(Deserialize, Default)]
struct Cables {
    /// By string position; null where a string has none.
    #[serde(default)]
    dc: Vec<Option<Copper>>,
    /// By inverter device id.
    #[serde(default)]
    ac: HashMap<u32, AcCopper>,
}

/// A copper cable: metres one way and mm² per conductor.
#[derive(Deserialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
struct Copper {
    length: f64,
    cross_section: f64,
}

impl From<Copper> for Cable {
    fn from(copper: Copper) -> Self {
        Self {
            length: copper.length,
            cross_section: copper.cross_section,
        }
    }
}

#[derive(Deserialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
struct AcCopper {
    #[serde(flatten)]
    copper: Copper,
    three_phase: bool,
}

/// A linear performance warranty in %, and how many years to give.
#[derive(Deserialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
struct Lifetime {
    first_year: f64,
    yearly: f64,
    years: u16,
}

impl YearRun {
    /// Each string's energy by position, zero for an unknown module type, and each inverter's
    /// with its inputs, by device id and input number.
    pub fn reply(&self) -> Value {
        let samples = match self.weather.samples() {
            Ok(samples) => samples,
            Err(error) => return json!({ "error": error }),
        };
        let Wired {
            layout,
            order,
            devices,
        } = match self.plant.layout(&self.inverter_types) {
            Ok(wired) => wired,
            Err(refused) => return json!({ "error": refused.to_string() }),
        };
        let horizon = match horizon(self.horizon.as_deref()) {
            Ok(horizon) => horizon,
            Err(refused) => return json!({ "error": refused.to_string() }),
        };
        let inputs = self.inputs(horizon.as_ref(), &order, &devices);
        let step = self.weather.step;
        let run = TABLE.with_borrow_mut(|table| year_run(&layout, table, &inputs, &samples, step));
        let mut strings = vec![energy(&Energy::default()); self.plant.strings.len()];
        let modelled = run
            .inverters
            .iter()
            .flat_map(|inverter| &inverter.inputs)
            .flat_map(|input| &input.strings);
        for (&position, string) in order.iter().zip(modelled) {
            if let Some(at) = strings.get_mut(position) {
                *at = energy(string);
            }
        }
        let inverters: Vec<Value> = devices
            .iter()
            .zip(&run.inverters)
            .map(|((device, numbers), inverter)| inverter_reply(*device, numbers, inverter))
            .collect();
        let plant = run.chain();
        let mut reply = Map::new();
        reply.insert("strings".to_owned(), json!(strings));
        reply.insert("inverters".to_owned(), json!(inverters));
        reply.insert("chain".to_owned(), chain(&plant));
        if let Some(lifetime) = self.warranty {
            let warranty = Warranty {
                first_year: lifetime.first_year,
                yearly: lifetime.yearly,
            };
            let years = warranty.yields(plant.end().total, lifetime.years);
            reply.insert("years".to_owned(), json!(years));
        }
        json!({ "ok": reply })
    }

    /// What the run is given beside the plant, in the layout's order: each string's DC cable by
    /// its position, each inverter's AC cable by its device.
    fn inputs<'a>(
        &self,
        horizon: Option<&'a Horizon>,
        order: &[usize],
        devices: &[(u32, Vec<u32>)],
    ) -> RunInputs<'a> {
        let dc = |&position: &usize| self.cables.dc.get(position).copied().flatten();
        RunInputs {
            horizon,
            soiling: self.soiling,
            dc_cables: order.iter().map(|p| dc(p).map(Cable::from)).collect(),
            ac_cables: devices
                .iter()
                .map(|(device, _)| {
                    self.cables.ac.get(device).map(|ac| AcCable {
                        cable: ac.copper.into(),
                        three_phase: ac.three_phase,
                    })
                })
                .collect(),
        }
    }
}

/// An inverter's energy by device id, its inputs' by number, its AC side if typed, and its chain.
fn inverter_reply(device: u32, numbers: &[u32], inverter: &InverterYear) -> Value {
    let inputs: Vec<Value> = numbers
        .iter()
        .zip(&inverter.inputs)
        .map(|(number, input)| json!({ "input": number, "energy": energy(&input.energy) }))
        .collect();
    let mut reply = Map::new();
    reply.insert("device".to_owned(), json!(device));
    reply.insert("dc".to_owned(), energy(&inverter.dc));
    if let Some(ac) = &inverter.ac {
        let ac = json!({ "energy": energy(&ac.energy), "clipped": energy(&ac.clipped) });
        reply.insert("ac".to_owned(), ac);
    }
    reply.insert("inputs".to_owned(), json!(inputs));
    reply.insert("chain".to_owned(), chain(&inverter.chain));
    Value::Object(reply)
}

/// The planes' energy, then each loss by its stable id and names, with the energy after it and
/// the energy it took.
fn chain(chain: &Chain) -> Value {
    let steps: Vec<Value> = chain
        .steps
        .iter()
        .zip(chain.losses())
        .map(|(step, (loss, lost))| {
            json!({
                "id": loss.id(),
                "en": loss.en(),
                "de": loss.de(),
                "after": energy(&step.after),
                "lost": energy(&lost),
            })
        })
        .collect();
    json!({ "planes": energy(&chain.planes), "steps": steps })
}

fn energy(energy: &Energy) -> Value {
    json!({ "months": energy.months, "total": energy.total })
}
