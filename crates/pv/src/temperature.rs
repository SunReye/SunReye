//! Cell temperature from plane-of-array irradiance.

/// Faiman 1977 heat-loss coefficients, as pvlib's defaults.
const FAIMAN_U0: f64 = 25.0;
const FAIMAN_U1: f64 = 6.84;
/// A typical NOCT in °C; ADR 17's module type carries none.
const NOCT: f64 = 45.0;

/// The cell temperature in °C: Faiman with wind, else the NOCT rise (Ross).
#[must_use]
pub fn cell_temperature(poa_global: f64, air: f64, wind: Option<f64>) -> f64 {
    let rise = wind.map_or((NOCT - 20.0) / 800.0, |wind| {
        1.0 / FAIMAN_U1.mul_add(wind, FAIMAN_U0)
    });

    poa_global.mul_add(rise, air)
}
