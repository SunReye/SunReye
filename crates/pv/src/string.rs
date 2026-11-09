//! One string: effective irradiance, cell temperature, then the datasheet scaled by module count.

use crate::perez::cos_incidence;
use crate::{PvString, Sky, StringOutput, cell_temperature, plane_irradiance};

/// Martin and Ruiz 2001, pvlib's default for glass-fronted modules.
const MARTIN_RUIZ_AR: f64 = 0.16;
/// pvlib's `martin_ruiz_diffuse` sky factor stays within 0.951–0.957 from 0° to 90° tilt.
const DIFFUSE_IAM: f64 = 0.95;
/// Datasheet values hold at standard test conditions.
const STC_IRRADIANCE: f64 = 1000.0;
const STC_TEMPERATURE: f64 = 25.0;

/// The string's maximum power point under one sky.
#[must_use]
pub fn string_output(string: &PvString, sky: &Sky) -> StringOutput {
    let poa = plane_irradiance(string.plane, sky);
    let diffuse = poa.sky_diffuse + poa.ground_diffuse;
    let effective = poa.beam.mul_add(
        incidence_loss(cos_incidence(string.plane, sky.sun)),
        diffuse * DIFFUSE_IAM,
    );
    let warming = cell_temperature(poa.beam + diffuse, sky.temperature, sky.wind) - STC_TEMPERATURE;
    let module = string.module;
    let modules = f64::from(string.modules);

    let power = effective / STC_IRRADIANCE
        * modules
        * module.pmax
        * module.power_coefficient.mul_add(warming / 100.0, 1.0)
        * (1.0 - string.loss / 100.0);

    if power <= 0.0 {
        return StringOutput {
            current: 0.0,
            voltage: 0.0,
            power: 0.0,
        };
    }

    let voltage = modules * module.vmp * module.voltage_coefficient.mul_add(warming / 100.0, 1.0);

    StringOutput {
        current: power / voltage,
        voltage,
        power,
    }
}

/// The fraction of beam light the glass lets through.
fn incidence_loss(cos_aoi: f64) -> f64 {
    if cos_aoi <= 0.0 {
        return 0.0;
    }

    (1.0 - (-cos_aoi / MARTIN_RUIZ_AR).exp()) / (1.0 - (-1.0 / MARTIN_RUIZ_AR).exp())
}
