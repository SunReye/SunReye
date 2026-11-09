//! The PV model: pure `estimate(layout, weather)`, built natively and for WASM (ADR 17).
//!
//! Angles are in degrees. Azimuths follow ADR 17: 0 = south, −90 = east, 90 = west.

mod perez;
mod temperature;

pub use perez::plane_irradiance;
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

#[cfg(test)]
mod tests;
