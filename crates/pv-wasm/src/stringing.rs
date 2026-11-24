//! Auto-stringing, for the builder a face at a time and for a consumer a roof at once (ADR 20).

use std::collections::HashMap;

use serde::Deserialize;
use serde_json::{Value, json};
use sunreye_pv::{
    InverterLimits, ModuleType, Scene, Unstrung, Wiring, auto_string, auto_string_face,
};

use crate::clear::Datasheet;
use crate::sizing::Limits;

/// What is known of the inverter the new strings go to.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Inverter {
    max_input_voltage: Option<f64>,
    inputs: Option<Vec<Limits>>,
}

/// A scene, its module types, the inverter by device and the layout's strings so far, which the
/// new ones follow; the grid where a face alone is strung.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Stringing {
    scene: Scene,
    module_types: Vec<Datasheet>,
    device: u32,
    inverter: Inverter,
    taken: Vec<Wiring>,
    #[serde(default)]
    grid: usize,
}

impl Stringing {
    fn types(&self) -> HashMap<u32, ModuleType> {
        self.module_types
            .iter()
            .map(|datasheet| (datasheet.id, datasheet.model()))
            .collect()
    }

    fn limits(&self) -> InverterLimits {
        InverterLimits {
            max_input_voltage: self.inverter.max_input_voltage,
            inputs: self
                .inverter
                .inputs
                .as_ref()
                .map(|inputs| inputs.iter().map(|input| input.model()).collect()),
        }
    }

    /// Grid `grid` strung: the scene, the new strings and how many modules stay over; `refused`
    /// `input` where no input is free; null where the grid holds no module in no string.
    pub fn face(&self) -> Value {
        let strung = auto_string_face(
            &self.scene,
            self.grid,
            &self.types(),
            self.device,
            &self.limits(),
            &self.taken,
        );
        match strung {
            Ok(strung) => {
                json!({ "scene": strung.scene, "strings": strung.strings, "left": strung.left })
            }
            Err(Unstrung::NoFreeInput) => json!({ "refused": "input" }),
            Err(Unstrung::Nothing) => Value::Null,
        }
    }

    /// Every face strung, the one with the most modules in no string first.
    pub fn roof(&self) -> Value {
        let (scene, strings, left) = auto_string(
            &self.scene,
            &self.types(),
            self.device,
            &self.limits(),
            &self.taken,
        );
        json!({ "scene": scene, "strings": strings, "left": left })
    }
}
