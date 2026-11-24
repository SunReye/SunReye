//! MPPT window warnings and the longest string, for the builder (ADR 20).

use std::collections::BTreeMap;

use serde::Deserialize;
use serde_json::{Value, json};
use sunreye_pv::{
    InverterLimits, ModuleType, MpptLimits, Sizing, Wired, longest_string, window_warnings,
};

use crate::clear::{Datasheet, Wiring};

/// One MPPT input's limits, as the core's capabilities list them (ADR 9).
#[derive(Deserialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
struct Limits {
    max_current: f64,
    min_voltage: f64,
    max_voltage: f64,
    start_voltage: f64,
}

impl Limits {
    const fn model(self) -> MpptLimits {
        MpptLimits {
            max_current: self.max_current,
            min_voltage: self.min_voltage,
            max_voltage: self.max_voltage,
            start_voltage: self.start_voltage,
        }
    }
}

/// Module types, strings and each inverter's inputs' limits by device id.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Checked {
    module_types: Vec<Datasheet>,
    strings: Vec<Wiring>,
    inverters: BTreeMap<u32, Vec<Limits>>,
}

/// What a string of an unknown module type is sized as: with no module, it warns for its input
/// alone.
const UNKNOWN: ModuleType = ModuleType {
    vmp: 0.0,
    imp: 0.0,
    voc: 0.0,
    isc: 0.0,
    voltage_coefficient: 0.0,
    current_coefficient: 0.0,
    width: 0.0,
    height: 0.0,
    bypass_diodes: 0,
};

fn worded(warning: &Sizing) -> Value {
    match *warning {
        Sizing::Start {
            string,
            volts,
            limit,
        } => json!({ "kind": "start", "string": string, "volts": volts, "limit": limit }),
        Sizing::Low {
            string,
            volts,
            limit,
        } => json!({ "kind": "low", "string": string, "volts": volts, "limit": limit }),
        Sizing::High {
            string,
            volts,
            limit,
        } => json!({ "kind": "high", "string": string, "volts": volts, "limit": limit }),
        Sizing::Open {
            string,
            volts,
            limit,
        } => json!({ "kind": "open", "string": string, "volts": volts, "limit": limit }),
        Sizing::Current {
            device,
            input,
            amperes,
            limit,
        } => json!({
            "kind": "current", "device": device, "input": input, "amperes": amperes, "limit": limit,
        }),
        Sizing::Uneven { device, input } => {
            json!({ "kind": "uneven", "device": device, "input": input })
        }
        Sizing::NoInput { string } => json!({ "kind": "noInput", "string": string }),
    }
}

impl Checked {
    /// The layout's MPPT window warnings; a string of an unknown module type is left out, its
    /// position kept. The builder checks the inverters' maximum DC input voltage on its own.
    pub fn reply(&self) -> Value {
        let inverters: BTreeMap<u32, InverterLimits> = self
            .inverters
            .iter()
            .map(|(device, inputs)| {
                let limits = InverterLimits {
                    max_input_voltage: None,
                    inputs: Some(inputs.iter().map(|input| input.model()).collect()),
                };
                (*device, limits)
            })
            .collect();
        let wired: Vec<Wired> = self
            .strings
            .iter()
            .map(|wiring| {
                let datasheet = self
                    .module_types
                    .iter()
                    .find(|d| d.id == wiring.module_type);
                Wired {
                    device: wiring.device,
                    input: wiring.input,
                    modules: datasheet.map_or(0, |_| wiring.modules),
                    module: datasheet.map_or(UNKNOWN, Datasheet::model),
                }
            })
            .collect();
        let found: Vec<Value> = window_warnings(&wired, &inverters)
            .iter()
            .map(worded)
            .collect();
        Value::Array(found)
    }
}

/// A module type, an inverter's maximum DC input voltage and one input's limits.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Longest {
    module_type: Datasheet,
    max_input_voltage: Option<f64>,
    limits: Option<Limits>,
}

impl Longest {
    /// The most modules auto-stringing wires in series; null without a limit.
    pub fn reply(&self) -> Value {
        let limits = self.limits.map(Limits::model);
        let most = longest_string(
            &self.module_type.model(),
            self.max_input_voltage,
            limits.as_ref(),
        );
        json!(most)
    }
}
