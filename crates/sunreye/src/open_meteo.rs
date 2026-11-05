//! Open-Meteo irradiance (3.x `providers/open-meteo.ts`, `open-meteo-shared.ts`): one request per distinct
//! plane, 15-minute instantaneous GTI, the plane-independent extras on the first request only.

use std::time::Duration;

use rustls::pki_types::CertificateDer;
use serde::Deserialize;

use crate::forecast::{Irradiance, Location};
use crate::https::{GetError, Limits, get_with_roots};

pub const URL: &str = "https://api.open-meteo.com/v1/forecast";
const LIMITS: Limits = Limits { timeout: Duration::from_secs(8), max_bytes: 1 << 20 };
const EXTRAS: &str = "direct_normal_irradiance_instant,temperature_2m,wind_speed_10m";

/// A panel orientation: tilt and azimuth, degrees.
pub type Plane = (f64, f64);

#[derive(Debug, thiserror::Error)]
pub enum FetchError {
    #[error(transparent)]
    Get(#[from] GetError),
    #[error("unreadable response: {0}")]
    Json(#[from] serde_json::Error),
    #[error("missing series fields")]
    Fields,
    #[error("missing irradiance series")]
    Irradiance,
}

#[derive(Debug, Default, Deserialize)]
struct Series {
    time: Option<Vec<String>>,
    temperature_2m: Option<Vec<Option<f64>>>,
    global_tilted_irradiance_instant: Option<Vec<Option<f64>>>,
    direct_normal_irradiance_instant: Option<Vec<Option<f64>>>,
    wind_speed_10m: Option<Vec<Option<f64>>>,
}

#[derive(Debug, Default, Deserialize)]
struct Response {
    utc_offset_seconds: Option<i32>,
    /// The IANA zone of the location, as `timezone=auto` resolves it.
    timezone: Option<String>,
    minutely_15: Option<Series>,
}

/// One series and the zone its location keeps.
#[derive(Debug, Clone, PartialEq)]
pub struct Fetched {
    pub irradiance: Irradiance,
    pub time_zone: Option<String>,
}

/// Distinct orientations in first-seen order; identical planes share one request.
fn unique(planes: &[Plane]) -> Vec<Plane> {
    let mut out: Vec<Plane> = Vec::new();
    for plane in planes {
        if !out.contains(plane) {
            out.push(*plane);
        }
    }
    out
}

fn url(base: &str, location: Location, (tilt, azimuth): Plane, extras: bool) -> String {
    let vars = if extras {
        format!("global_tilted_irradiance_instant,{EXTRAS}")
    } else {
        "global_tilted_irradiance_instant".into()
    };
    format!(
        "{base}?latitude={}&longitude={}&minutely_15={vars}&tilt={tilt}&azimuth={azimuth}\
         &wind_speed_unit=ms&timezone=auto&forecast_days=2",
        location.latitude, location.longitude
    )
}

fn zeroed(series: &[Option<f64>]) -> Vec<f64> {
    series.iter().map(|v| v.unwrap_or(0.0)).collect()
}

/// The series aligned on the first plane's times: one GTI row per array, extras only when they line up.
fn assemble(
    location: Location,
    planes: &[Plane],
    responses: &[(Plane, Response)],
) -> Result<Fetched, FetchError> {
    let first = responses.first().ok_or(FetchError::Fields)?;
    let (utc_offset_seconds, time_zone) = (first.1.utc_offset_seconds.unwrap_or(0), first.1.timezone.clone());
    let series = first.1.minutely_15.as_ref().ok_or(FetchError::Fields)?;
    let (Some(times), Some(temperature)) = (&series.time, &series.temperature_2m) else {
        return Err(FetchError::Fields);
    };
    let aligned =
        |s: &Option<Vec<Option<f64>>>| s.as_ref().filter(|s| s.len() == times.len()).map(|s| zeroed(s));
    let gti = planes
        .iter()
        .map(|plane| {
            let found = responses.iter().find(|(p, _)| p == plane);
            let gti =
                found.and_then(|(_, r)| aligned(&r.minutely_15.as_ref()?.global_tilted_irradiance_instant));
            gti.ok_or(FetchError::Irradiance)
        })
        .collect::<Result<_, _>>()?;
    Ok(Fetched {
        irradiance: Irradiance {
            times: times.clone(),
            utc_offset_seconds,
            location,
            temperature: zeroed(temperature),
            gti,
            dni: aligned(&series.direct_normal_irradiance_instant),
            wind_speed: aligned(&series.wind_speed_10m),
        },
        time_zone,
    })
}

/// The series for `planes`, one per array, from `base`.
pub async fn fetch(
    base: &str,
    roots: &[CertificateDer<'_>],
    location: Location,
    planes: &[Plane],
) -> Result<Fetched, FetchError> {
    let mut responses = Vec::new();
    for (i, plane) in unique(planes).into_iter().enumerate() {
        let body = get_with_roots(&url(base, location, plane, i == 0), LIMITS, roots).await?;
        responses.push((plane, serde_json::from_slice(&body)?));
    }
    assemble(location, planes, &responses)
}

#[cfg(test)]
mod tests {
    use serde_json::{Value, json};

    use super::*;

    const HERE: Location = Location { latitude: 50.5, longitude: 8.25 };

    fn response(body: Value) -> Response {
        serde_json::from_value(body).expect("response")
    }

    #[test]
    fn the_first_plane_asks_for_the_extras_and_the_rest_for_gti_only() {
        assert_eq!(
            url("https://x/v1/forecast", HERE, (30.0, -90.0), true),
            "https://x/v1/forecast?latitude=50.5&longitude=8.25&minutely_15=global_tilted_irradiance_instant,\
             direct_normal_irradiance_instant,temperature_2m,wind_speed_10m&tilt=30&azimuth=-90\
             &wind_speed_unit=ms&timezone=auto&forecast_days=2"
        );
        assert!(
            url("https://x", HERE, (0.0, 0.0), false)
                .contains("minutely_15=global_tilted_irradiance_instant&")
        );
    }

    #[test]
    fn identical_planes_share_one_request() {
        assert_eq!(unique(&[(30.0, 0.0), (10.0, 90.0), (30.0, 0.0)]), [(30.0, 0.0), (10.0, 90.0)]);
    }

    #[test]
    fn each_array_takes_its_plane_s_gti_and_nulls_read_as_zero() {
        let first = response(json!({
            "utc_offset_seconds": 7200, "timezone": "Europe/Berlin",
            "minutely_15": {"time": ["2026-07-24T10:00", "2026-07-24T10:15"], "temperature_2m": [20.0, null],
                "global_tilted_irradiance_instant": [500.0, null], "direct_normal_irradiance_instant": [600.0, 610.0],
                "wind_speed_10m": [1.0]}
        }));
        let second = response(json!({"minutely_15": {"global_tilted_irradiance_instant": [100.0, 200.0]}}));
        let planes = [(30.0, 0.0), (10.0, 90.0), (30.0, 0.0)];
        let fetched =
            assemble(HERE, &planes, &[((30.0, 0.0), first), ((10.0, 90.0), second)]).expect("series");
        assert_eq!(fetched.time_zone.as_deref(), Some("Europe/Berlin"));
        let series = fetched.irradiance;
        assert_eq!((series.utc_offset_seconds, &series.temperature), (7200, &vec![20.0, 0.0]));
        assert_eq!(series.gti, [vec![500.0, 0.0], vec![100.0, 200.0], vec![500.0, 0.0]]);
        assert_eq!((series.dni, series.wind_speed), (Some(vec![600.0, 610.0]), None), "wind is misaligned");
    }

    #[test]
    fn a_response_without_times_temperature_or_a_plane_s_gti_is_refused() {
        let plane = (30.0, 0.0);
        let no_temperature = response(json!({"minutely_15": {"time": ["2026-07-24T10:00"]}}));
        assert!(matches!(assemble(HERE, &[plane], &[(plane, no_temperature)]), Err(FetchError::Fields)));
        let short = response(json!({"minutely_15": {"time": ["a", "b"], "temperature_2m": [1, 2],
            "global_tilted_irradiance_instant": [1]}}));
        assert!(matches!(assemble(HERE, &[plane], &[(plane, short)]), Err(FetchError::Irradiance)));
        assert!(matches!(assemble(HERE, &[plane], &[]), Err(FetchError::Fields)));
    }
}
