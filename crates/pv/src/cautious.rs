//! The cautious yield (ADR 17): a plant's yearly yield follows the yearly irradiation on its
//! planes almost in proportion, so the spread of past years' irradiation around the typical year's
//! sets how far below the simulated typical year P90 lies.

use crate::estimate::{SECONDS_PER_DAY, day_of_year};
use crate::{Layout, Plane, Sky, Weather, plane_irradiance, sun_position};

/// The layout's Perez irradiation over `weather` in Wh/m², each sample held for `step` seconds.
///
/// The mean over its modules weighted by datasheet power (Vmp × Imp), with no shade,
/// incidence-angle loss or electrics. Zero for a layout without modules.
#[must_use]
pub fn irradiation(layout: &Layout, weather: &[Weather], step: i64) -> f64 {
    let mut planes: Vec<(Plane, f64)> = Vec::new();
    let strings = layout
        .inverters
        .iter()
        .flat_map(|inverter| &inverter.inputs)
        .flat_map(|input| &input.strings);
    for string in strings {
        let power = string.module.vmp * string.module.imp;
        for module in &string.modules {
            match planes.iter_mut().find(|(plane, _)| *plane == module.plane) {
                Some((_, weight)) => *weight += power,
                None => planes.push((module.plane, power)),
            }
        }
    }
    let total: f64 = planes.iter().map(|(_, weight)| weight).sum();
    if total <= 0.0 {
        return 0.0;
    }
    #[expect(
        clippy::cast_precision_loss,
        reason = "a step is seconds, far below 2^52"
    )]
    let hours = step as f64 / 3600.0;
    let watts: f64 = weather
        .iter()
        .filter(|w| w.ghi > 0.0 || w.dni > 0.0 || w.dhi > 0.0)
        .map(|w| {
            let sky = Sky {
                sun: sun_position(w.unix, layout.location),
                day_of_year: day_of_year(w.unix.div_euclid(SECONDS_PER_DAY)),
                ghi: w.ghi,
                dni: w.dni,
                dhi: w.dhi,
                temperature: w.temperature,
                wind: w.wind,
            };
            planes
                .iter()
                .map(|(plane, weight)| {
                    let p = plane_irradiance(*plane, &sky);
                    (p.beam + p.sky_diffuse + p.ground_diffuse) * weight
                })
                .sum::<f64>()
        })
        .sum();
    watts / total * hours
}

/// The standard normal quantile below which a tenth of the distribution lies, negated.
const P90: f64 = 1.281_551_565_544_600_4;

/// The expected and the cautious yield, and how they were made.
#[derive(Debug, Clone, PartialEq)]
pub struct Cautious {
    /// The simulated typical year's energy itself.
    pub p50: f64,
    /// The yield exceeded in nine years of ten: P50 less 1.2816 deviations of the ratios.
    pub p90: f64,
    pub basis: Basis,
}

/// How a cautious figure was made: the ratios of each past year's irradiation on the planes to
/// the typical year's, whose deviation sets P90 below the simulated typical year.
#[derive(Debug, Clone, PartialEq)]
pub struct Basis {
    /// The typical year's irradiation on the planes, in Wh/m².
    pub typical: f64,
    /// Each past year and its irradiation on the planes, in Wh/m².
    pub years: Vec<(i64, f64)>,
    /// The mean and the sample deviation of the ratios; P50 does not read the mean, which shows
    /// how the typical year sits among the past years.
    pub mean: f64,
    pub deviation: f64,
}

/// P50 and P90 of `simulated`, the typical year's energy; `None` with fewer than two years or no
/// typical irradiation.
///
/// P50 is `simulated` itself and P90 is `simulated × (1 − 1.2816 σ)`, σ the sample deviation of
/// each past year's irradiation over `typical`, the typical year's.
#[must_use]
pub fn cautious(simulated: f64, typical: f64, years: &[(i64, f64)]) -> Option<Cautious> {
    if years.len() < 2 || typical <= 0.0 {
        return None;
    }
    #[expect(clippy::cast_precision_loss, reason = "a few dozen years")]
    let n = years.len() as f64;
    let ratios = years.iter().map(|(_, wh)| wh / typical);
    let mean = ratios.clone().sum::<f64>() / n;
    let deviation = (ratios.map(|r| (r - mean).powi(2)).sum::<f64>() / (n - 1.0)).sqrt();
    Some(Cautious {
        p50: simulated,
        p90: simulated * P90.mul_add(-deviation, 1.0),
        basis: Basis {
            typical,
            years: years.to_vec(),
            mean,
            deviation,
        },
    })
}
