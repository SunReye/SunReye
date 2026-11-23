//! A plant's run over a year of weather (ADR 17): energy per string, MPPT input and inverter.

use std::collections::HashMap;

use serde::Deserialize;
use serde_json::{Value, json};
use sunreye_pv::{Energy, InverterType, Weather, year};

use crate::clear::{Plant, Wired};

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
    /// Each input's limits come from its inverter's type; without one, nothing is capped.
    #[serde(default)]
    inverter_types: HashMap<u32, InverterType>,
    weather: Steps,
}

impl YearRun {
    /// Each string's energy by position, zero for an unknown module type, and each inverter's
    /// with its inputs, by device id and input number.
    pub fn reply(&self) -> Value {
        let samples = match self.weather.samples() {
            Ok(samples) => samples,
            Err(error) => return json!({ "error": error }),
        };
        let limits = |device, input: u32| {
            let limits = self.inverter_types.get(&device)?.limits();
            limits
                .get(usize::try_from(input).ok()?.checked_sub(1)?)
                .copied()
        };
        let Wired {
            layout,
            order,
            devices,
        } = match self.plant.layout(limits) {
            Ok(wired) => wired,
            Err(refused) => return json!({ "error": refused.to_string() }),
        };
        let run = year(&layout, &samples, self.weather.step);
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
            .map(|((device, inputs), inverter)| {
                let inputs: Vec<Value> = inputs
                    .iter()
                    .zip(&inverter.inputs)
                    .map(|(number, input)| json!({ "input": number, "energy": energy(&input.energy) }))
                    .collect();
                json!({ "device": device, "dc": energy(&inverter.dc), "inputs": inputs })
            })
            .collect();
        json!({ "ok": { "strings": strings, "inverters": inverters } })
    }
}

fn energy(energy: &Energy) -> Value {
    json!({ "months": energy.months, "total": energy.total })
}
