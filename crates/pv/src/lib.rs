//! The PV model: pure `estimate(layout, weather)`, built natively and for WASM (ADR 17).
//!
//! Angles are in degrees. Azimuths follow ADR 17: 0 = south, −90 = east, 90 = west.

mod estimate;
mod inverter;
mod mppt;
mod perez;
mod string;
mod sun;
mod temperature;

pub use estimate::estimate;
pub use inverter::inverter_power;
pub use mppt::{module_counts_differ, mppt_output};
pub use perez::plane_irradiance;
pub use string::string_output;
pub use sun::sun_position;
pub use temperature::cell_temperature;

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
    /// Watts at standard test conditions.
    pub pmax: f64,
    /// Volts at the maximum power point.
    pub vmp: f64,
    /// Of Pmax, in %/K.
    pub power_coefficient: f64,
    /// Of Voc, in %/K; applied to Vmp.
    pub voltage_coefficient: f64,
}

/// Modules of one type in series on one plane.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PvString {
    pub module: ModuleType,
    pub modules: u16,
    pub plane: Plane,
    /// Wiring, soiling and mismatch, in %.
    pub loss: f64,
}

/// A string's maximum power point: amperes, volts and watts.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct StringOutput {
    pub current: f64,
    pub voltage: f64,
    pub power: f64,
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
