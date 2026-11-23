//! A rounded location's typical year and the cautious yield (ADR 17), without a browser.

use serde::Deserialize;
use serde_json::{Value, json};
use sunreye_pv::{Location, Weather, cautious, irradiation, typical_year};

use crate::Place;
use crate::clear::{Plant, Wired};
use crate::year::Steps;

/// A place to 0.01°, the rounded location a typical year belongs to.
pub fn rounded(place: Place) -> Value {
    let Location {
        latitude,
        longitude,
    } = Location::from(place).rounded();
    json!({ "latitude": latitude, "longitude": longitude })
}

/// Twenty or more whole UTC years at one step.
#[derive(Deserialize)]
pub struct PastYears {
    years: Vec<Steps>,
}

impl PastYears {
    /// The typical year as columns at the years' step, and each month's source year.
    pub fn reply(&self) -> Value {
        let step = self.years.first().map_or(0, |y| y.step);
        if self.years.iter().any(|y| y.step != step) {
            return json!({ "error": "past years differ in step" });
        }
        let years: Vec<Vec<Weather>> = match self.years.iter().map(Steps::samples).collect() {
            Ok(years) => years,
            Err(error) => return json!({ "error": error }),
        };
        match typical_year(&years, step) {
            Ok(typical) => json!({ "ok": {
                "weather": columns(&typical.weather, step),
                "sources": typical.sources,
            }}),
            Err(refused) => json!({ "error": refused.to_string() }),
        }
    }
}

fn columns(weather: &[Weather], step: i64) -> Value {
    let column = |f: fn(&Weather) -> f64| weather.iter().map(f).collect::<Vec<_>>();
    json!({
        "start": weather.first().map_or(0, |w| w.unix),
        "step": step,
        "ghi": column(|w| w.ghi),
        "dni": column(|w| w.dni),
        "dhi": column(|w| w.dhi),
        "temperature": column(|w| w.temperature),
        "wind": weather.iter().map(|w| w.wind).collect::<Vec<_>>(),
    })
}

/// A plant and a year of weather.
#[derive(Deserialize)]
pub struct Irradiated {
    #[serde(flatten)]
    plant: Plant,
    weather: Steps,
}

impl Irradiated {
    /// The plant's irradiation on its planes in Wh/m², without shade or electrics.
    pub fn reply(&self) -> Value {
        let samples = match self.weather.samples() {
            Ok(samples) => samples,
            Err(error) => return json!({ "error": error }),
        };
        match self.plant.layout(|_, _| None) {
            Ok(Wired { layout, .. }) => {
                json!({ "ok": irradiation(&layout, &samples, self.weather.step) })
            }
            Err(refused) => json!({ "error": refused.to_string() }),
        }
    }
}

#[derive(Deserialize)]
struct PastIrradiation {
    year: i64,
    irradiation: f64,
}

/// A simulated typical year's energy, its irradiation and each past year's.
#[derive(Deserialize)]
pub struct Scaling {
    simulated: f64,
    typical: f64,
    years: Vec<PastIrradiation>,
}

impl Scaling {
    /// P50 and P90, and how they were made.
    pub fn reply(&self) -> Value {
        let years: Vec<(i64, f64)> = self.years.iter().map(|y| (y.year, y.irradiation)).collect();
        let Some(figure) = cautious(self.simulated, self.typical, &years) else {
            return json!({ "error": "two past years and a typical irradiation are needed" });
        };
        let basis = &figure.basis;
        json!({ "ok": {
            "p50": figure.p50,
            "p90": figure.p90,
            "basis": {
                "method": "irradiationScaling",
                "typical": basis.typical,
                "years": basis.years.iter()
                    .map(|(year, irradiation)| json!({ "year": year, "irradiation": irradiation }))
                    .collect::<Vec<_>>(),
                "mean": basis.mean,
                "deviation": basis.deviation,
            },
        }})
    }
}
