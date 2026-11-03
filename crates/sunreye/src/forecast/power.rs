//! One array's AC power from irradiance and weather: incidence-angle loss on the beam, cell-temperature
//! derate, static system loss. Each refinement falls back to a simpler form when its input is absent.

use serde::Deserialize;

/// NOCT rise: cells run 25 °C above ambient at 800 W/m².
const CELL_TEMP_RISE_PER_WM2: f64 = 25.0 / 800.0;
/// Faiman, IEC 61853-2 open-rack coefficients, W/m²K.
const FAIMAN_U0: f64 = 25.0;
const FAIMAN_U1: f64 = 6.84;
/// Cell temperature the datasheet coefficient is relative to.
pub const STC_CELL_TEMP_C: f64 = 25.0;
/// Martin & Ruiz 2001 beam modifier; diffuse light from the whole sky dome loses a constant share.
const MARTIN_RUIZ_AR: f64 = 0.16;
const IAM_DIFFUSE: f64 = 0.95;

/// One instant's environment for one array.
#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PvSample {
    /// Plane-of-array irradiance, W/m².
    pub gti_wm2: f64,
    pub ambient_c: f64,
    /// Direct-normal irradiance, W/m²; with `cos_aoi` it splits beam from diffuse.
    pub dni_wm2: Option<f64>,
    pub cos_aoi: Option<f64>,
    /// 10 m wind, m/s; selects the Faiman cell temperature.
    pub wind_ms: Option<f64>,
}

fn iam_martin_ruiz(cos_theta: f64) -> f64 {
    if cos_theta <= 0.0 {
        return 0.0;
    }
    (1.0 - (-cos_theta / MARTIN_RUIZ_AR).exp()) / (1.0 - (-1.0 / MARTIN_RUIZ_AR).exp())
}

/// Irradiance reaching the cells. Without a beam/diffuse split a beam modifier would over-penalise cloudy
/// hours, so raw GTI stands.
fn effective_irradiance_wm2(sample: &PvSample) -> f64 {
    let (Some(dni), Some(cos_aoi)) = (sample.dni_wm2, sample.cos_aoi) else {
        return sample.gti_wm2;
    };
    let beam = sample.gti_wm2.min(dni * cos_aoi.max(0.0));
    let diffuse = sample.gti_wm2 - beam;
    beam * iam_martin_ruiz(cos_aoi) + diffuse * IAM_DIFFUSE
}

/// Cells heat with the full incident irradiance, reflected or not.
fn cell_temp_c(sample: &PvSample) -> f64 {
    match sample.wind_ms {
        None => sample.ambient_c + sample.gti_wm2 * CELL_TEMP_RISE_PER_WM2,
        Some(wind) => sample.ambient_c + sample.gti_wm2 / (FAIMAN_U0 + FAIMAN_U1 * wind),
    }
}

/// Expected AC watts of one array of `kwp` for a sample.
pub fn pv_power_w(sample: &PvSample, kwp: f64, temp_coefficient_pct_per_c: f64, system_loss_pct: f64) -> f64 {
    let effective = effective_irradiance_wm2(sample);
    if effective <= 0.0 {
        return 0.0;
    }
    let derate = 1.0 + (temp_coefficient_pct_per_c / 100.0) * (cell_temp_c(sample) - STC_CELL_TEMP_C);
    let dc_w = kwp * effective * derate.max(0.0);
    (dc_w * (1.0 - system_loss_pct / 100.0)).max(0.0)
}
