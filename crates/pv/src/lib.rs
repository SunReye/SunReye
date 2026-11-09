//! The PV model: pure `estimate(layout, weather)`, built natively and for WASM (ADR 17).
//!
//! Angles are in degrees. Azimuths follow ADR 17: 0 = south, −90 = east, 90 = west.

mod diode;
mod estimate;
mod grid;
mod mppt;
mod perez;
mod scene;
mod shade;
mod string;
mod sun;
mod temperature;

pub use estimate::estimate;
pub use grid::{Cell, CellPlace, GAP, Misplaced, ModuleGrid, Placed, RoofFace, Size};
pub use mppt::{input_output, module_counts_differ};
pub use perez::plane_irradiance;
pub use scene::{Block, Face, Obstacle, Roof, Scene, Surface};
pub use sun::sun_position;
pub use temperature::cell_temperature;

/// A string's open-circuit voltage at a cell temperature in °C, by the datasheet's voltage
/// coefficient: what sizing checks against an inverter's maximum DC input voltage (ADR 20).
#[must_use]
pub fn open_circuit_voltage(module: &ModuleType, modules: u16, temperature: f64) -> f64 {
    let per_module =
        module.voc * (module.voltage_coefficient / 100.0).mul_add(temperature - 25.0, 1.0);
    per_module * f64::from(modules)
}

/// The orientation of a module's surface.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Plane {
    /// From horizontal.
    pub tilt: f64,
    pub azimuth: f64,
}

/// The sun's position.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Sun {
    pub zenith: f64,
    pub azimuth: f64,
}

/// A place on earth in degrees, north and east positive.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Location {
    pub latitude: f64,
    pub longitude: f64,
}

/// The weather at one instant, irradiance in W/m².
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Sky {
    pub sun: Sun,
    /// 1 to 366; the sun–earth distance scales extraterrestrial irradiance.
    pub day_of_year: u16,
    pub ghi: f64,
    pub dni: f64,
    pub dhi: f64,
    /// Air temperature in °C.
    pub temperature: f64,
    /// Wind speed in m/s, when the weather source has it.
    pub wind: Option<f64>,
}

/// Irradiance on a plane in W/m², before incidence-angle loss.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PlaneIrradiance {
    pub beam: f64,
    pub sky_diffuse: f64,
    pub ground_diffuse: f64,
}

/// The datasheet values the model uses.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ModuleType {
    /// Volts and amperes at the maximum power point.
    pub vmp: f64,
    pub imp: f64,
    /// Open-circuit volts and short-circuit amperes.
    pub voc: f64,
    pub isc: f64,
    /// Of Voc and Isc, in %/K.
    pub voltage_coefficient: f64,
    pub current_coefficient: f64,
    /// Metres.
    pub width: f64,
    pub height: f64,
    /// Each splits the module into one more substring along its long side.
    pub bypass_diodes: u8,
}

/// A point in metres: east, north and up from the scene's origin.
pub type Point = [f64; 3];

/// Where a module sits in the scene (ADR 20).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Place {
    pub centre: Point,
    /// Long side across the slope; otherwise it runs up the slope.
    pub landscape: bool,
}

/// One module of a string.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Module {
    pub plane: Plane,
    pub optimized: bool,
    /// Without a place nothing shades it.
    pub place: Option<Place>,
}

/// What casts beam shade: blocks, roofs and carports as triangles, tree crowns as spheres,
/// chimneys, poles and trunks as upright cylinders.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Occluder {
    Triangle([Point; 3]),
    Sphere {
        centre: Point,
        radius: f64,
    },
    Cylinder {
        base: Point,
        radius: f64,
        height: f64,
    },
}

/// Modules of one type in series.
#[derive(Debug, Clone, PartialEq)]
pub struct PvString {
    pub module: ModuleType,
    pub modules: Vec<Module>,
    /// Wiring, soiling and mismatch, in %.
    pub loss: f64,
}

impl PvString {
    /// A string entered by form: every module on one plane, unplaced, the first `optimized`
    /// with an optimizer.
    #[must_use]
    pub fn on_one_plane(
        module: ModuleType,
        plane: Plane,
        modules: u16,
        optimized: u16,
        loss: f64,
    ) -> Self {
        let modules = (0..modules)
            .map(|i| Module {
                plane,
                optimized: i < optimized,
                place: None,
            })
            .collect();
        Self {
            module,
            modules,
            loss,
        }
    }
}

/// One MPPT input's limits, from the inverter profile (ADR 5).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct MpptLimits {
    /// Amperes.
    pub max_current: f64,
    /// The voltage window, in volts.
    pub min_voltage: f64,
    pub max_voltage: f64,
    /// Volts.
    pub start_voltage: f64,
}

/// A plant's wiring: inverters, their MPPT inputs and the strings in parallel on each.
#[derive(Debug, Clone, PartialEq)]
pub struct Layout {
    pub location: Location,
    pub inverters: Vec<Inverter>,
    /// The scene's shade casters, in the frame of the modules' places.
    pub occluders: Vec<Occluder>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Inverter {
    /// Watts; without it the output is not capped.
    pub ac_rating: Option<f64>,
    pub inputs: Vec<Input>,
}

/// One MPPT input and its strings in parallel.
#[derive(Debug, Clone, PartialEq)]
pub struct Input {
    /// From the inverter profile; without them nothing is capped (ADR 5).
    pub limits: Option<MpptLimits>,
    pub strings: Vec<PvString>,
}

/// The weather at one instant, irradiance in W/m².
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Weather {
    /// Seconds since 1970, UTC.
    pub unix: i64,
    pub ghi: f64,
    pub dni: f64,
    pub dhi: f64,
    /// Air temperature in °C.
    pub temperature: f64,
    /// Wind speed in m/s, when the weather source has it.
    pub wind: Option<f64>,
}

/// A layout's output at one instant, in the layout's order.
#[derive(Debug, Clone, PartialEq)]
pub struct Estimate {
    pub inverters: Vec<InverterEstimate>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct InverterEstimate {
    /// Watts, capped at the AC rating.
    pub power: f64,
    pub inputs: Vec<InputEstimate>,
}

/// An MPPT input's operating point and each string's share of its power, in watts.
#[derive(Debug, Clone, PartialEq)]
pub struct InputEstimate {
    pub current: f64,
    pub voltage: f64,
    pub power: f64,
    pub strings: Vec<f64>,
}

#[cfg(test)]
mod tests;
