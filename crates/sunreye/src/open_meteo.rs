//! Open-Meteo irradiance (3.x `providers/open-meteo.ts`, `open-meteo-archive.ts`, `open-meteo-shared.ts`): one
//! request per distinct plane, instantaneous GTI, the plane-independent extras on the first request only. The
//! forecast is 15-minute and plant-local; the reanalysis archive hourly and labelled in UTC, so a range
//! across a DST change stays unambiguous.

use std::time::Duration;

use futures_util::future::try_join_all;
use jiff::Timestamp;
use jiff::civil::Date;
use reqwest::Url;
use rustls::pki_types::CertificateDer;
use serde::Deserialize;

use crate::forecast::{Irradiance, Location};
use crate::https::{GetError, Limits, get_with_roots};

pub const URL: &str = "https://api.open-meteo.com/v1/forecast";
pub const ARCHIVE_URL: &str = "https://archive-api.open-meteo.com/v1/archive";
const LIMITS: Limits = Limits { timeout: Duration::from_secs(8), max_bytes: 1 << 20 };
/// A 90-day backfill is one hourly series per plane.
const ARCHIVE_LIMITS: Limits = Limits { timeout: Duration::from_secs(15), max_bytes: 1 << 20 };
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
struct Series<T = String> {
    time: Option<Vec<T>>,
    temperature_2m: Option<Vec<Option<f64>>>,
    global_tilted_irradiance_instant: Option<Vec<Option<f64>>>,
    direct_normal_irradiance_instant: Option<Vec<Option<f64>>>,
    wind_speed_10m: Option<Vec<Option<f64>>>,
}

#[derive(Debug, Default, Deserialize)]
struct Response<T = String> {
    utc_offset_seconds: Option<i32>,
    /// `hourly` in an archive response.
    #[serde(alias = "hourly")]
    minutely_15: Option<Series<T>>,
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

fn vars(extras: bool) -> String {
    if extras {
        format!("global_tilted_irradiance_instant,{EXTRAS}")
    } else {
        "global_tilted_irradiance_instant".into()
    }
}

fn url(base: &str, location: Location, (tilt, azimuth): Plane, extras: bool) -> String {
    let vars = vars(extras);
    format!(
        "{base}?latitude={}&longitude={}&minutely_15={vars}&tilt={tilt}&azimuth={azimuth}\
         &wind_speed_unit=ms&timezone=auto&forecast_days=2",
        location.latitude, location.longitude
    )
}

fn archive_url(
    base: &str,
    location: Location,
    (tilt, azimuth): Plane,
    extras: bool,
    (start, end, zone): (Date, Date, &str),
) -> Result<String, GetError> {
    let mut url = Url::parse(base).map_err(|e| GetError::Url(format!("{base}: {e}")))?;
    url.query_pairs_mut().extend_pairs([
        ("latitude", location.latitude.to_string()),
        ("longitude", location.longitude.to_string()),
        ("start_date", start.to_string()),
        ("end_date", end.to_string()),
        ("hourly", vars(extras)),
        ("tilt", tilt.to_string()),
        ("azimuth", azimuth.to_string()),
        ("wind_speed_unit", "ms".into()),
        // Encoded: a `+` in `Etc/GMT+5` would otherwise arrive as a space.
        ("timezone", zone.into()),
        ("timeformat", "unixtime".into()),
    ]);
    Ok(url.into())
}

fn decode(body: &[u8]) -> Result<Response, FetchError> {
    Ok(serde_json::from_slice(body)?)
}

/// An archive response with its unix times as UTC labels, its offset 0.
fn decode_archive(body: &[u8]) -> Result<Response, FetchError> {
    let response: Response<i64> = serde_json::from_slice(body)?;
    let series = response
        .minutely_15
        .map(|s| {
            let time = s.time.map(|time| {
                let label =
                    |t: i64| Timestamp::from_second(t).map(|t| t.strftime("%Y-%m-%dT%H:%M").to_string());
                time.into_iter().map(label).collect::<Result<Vec<_>, _>>().map_err(|_| FetchError::Fields)
            });
            Ok::<_, FetchError>(Series {
                time: time.transpose()?,
                temperature_2m: s.temperature_2m,
                global_tilted_irradiance_instant: s.global_tilted_irradiance_instant,
                direct_normal_irradiance_instant: s.direct_normal_irradiance_instant,
                wind_speed_10m: s.wind_speed_10m,
            })
        })
        .transpose()?;
    Ok(Response { utc_offset_seconds: Some(0), minutely_15: series })
}

fn zeroed(series: &[Option<f64>]) -> Vec<f64> {
    series.iter().map(|v| v.unwrap_or(0.0)).collect()
}

/// The series aligned on the first plane's times: one GTI row per array, extras only when they line up.
fn assemble(
    location: Location,
    planes: &[Plane],
    responses: &[(Plane, Response)],
) -> Result<Irradiance, FetchError> {
    let first = responses.first().ok_or(FetchError::Fields)?;
    let utc_offset_seconds = first.1.utc_offset_seconds.unwrap_or(0);
    let series = first.1.minutely_15.as_ref().ok_or(FetchError::Fields)?;
    let times = series.time.as_ref().filter(|t| !t.is_empty()).ok_or(FetchError::Fields)?;
    let aligned =
        |s: &Option<Vec<Option<f64>>>| s.as_ref().filter(|s| s.len() == times.len()).map(|s| zeroed(s));
    let temperature = aligned(&series.temperature_2m).ok_or(FetchError::Fields)?;
    let gti = planes
        .iter()
        .map(|plane| {
            let found = responses.iter().find(|(p, _)| p == plane);
            let gti =
                found.and_then(|(_, r)| aligned(&r.minutely_15.as_ref()?.global_tilted_irradiance_instant));
            gti.ok_or(FetchError::Irradiance)
        })
        .collect::<Result<_, _>>()?;
    Ok(Irradiance {
        times: times.clone(),
        utc_offset_seconds,
        location,
        temperature,
        gti,
        dni: aligned(&series.direct_normal_irradiance_instant),
        wind_speed: aligned(&series.wind_speed_10m),
    })
}

/// The series for `planes`, one per array, from `base`; the planes are asked at once, so a refresh waits one
/// timeout however many there are.
pub async fn fetch(
    base: &str,
    roots: &[CertificateDer<'_>],
    location: Location,
    planes: &[Plane],
) -> Result<Irradiance, FetchError> {
    let asked = unique(planes).into_iter().enumerate().map(|(i, plane)| async move {
        let body = get_with_roots(&url(base, location, plane, i == 0), LIMITS, roots).await?;
        Ok::<_, FetchError>((plane, decode(&body)?))
    });
    assemble(location, planes, &try_join_all(asked).await?)
}

/// Hourly reanalysis for `planes` over the days `start` to `end` in the IANA zone `zone`, from `base`.
pub async fn fetch_archive(
    base: &str,
    roots: &[CertificateDer<'_>],
    location: Location,
    planes: &[Plane],
    days: (Date, Date, &str),
) -> Result<Irradiance, FetchError> {
    let mut responses = Vec::new();
    for (i, plane) in unique(planes).into_iter().enumerate() {
        let url = archive_url(base, location, plane, i == 0, days)?;
        responses.push((plane, decode_archive(&get_with_roots(&url, ARCHIVE_LIMITS, roots).await?)?));
    }
    assemble(location, planes, &responses)
}

#[cfg(test)]
mod tests {
    use jiff::civil::date;
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
    fn an_archive_request_names_the_days_in_the_plant_zone_hourly_in_unix_time() {
        let url = archive_url(
            "https://x/v1/archive",
            HERE,
            (30.0, -90.0),
            true,
            (date(2026, 7, 1), date(2026, 7, 3), "Asia/Kathmandu"),
        )
        .expect("base");
        let url = Url::parse(&url).expect("url");
        assert_eq!(url.as_str().split('?').next(), Some("https://x/v1/archive"));
        let pairs: Vec<(String, String)> = url.query_pairs().map(|(k, v)| (k.into(), v.into())).collect();
        let expected = [
            ("latitude", "50.5"),
            ("longitude", "8.25"),
            ("start_date", "2026-07-01"),
            ("end_date", "2026-07-03"),
            (
                "hourly",
                "global_tilted_irradiance_instant,direct_normal_irradiance_instant,temperature_2m,wind_speed_10m",
            ),
            ("tilt", "30"),
            ("azimuth", "-90"),
            ("wind_speed_unit", "ms"),
            ("timezone", "Asia/Kathmandu"),
            ("timeformat", "unixtime"),
        ]
        .map(|(k, v)| (k.to_owned(), v.to_owned()));
        assert_eq!(pairs, expected);
    }

    #[test]
    fn an_archive_request_keeps_the_plus_in_a_fixed_offset_zone() {
        let url = archive_url(
            "https://x/v1/archive",
            HERE,
            (30.0, 0.0),
            false,
            (date(2026, 7, 1), date(2026, 7, 3), "Etc/GMT+5"),
        )
        .expect("base");
        let url = Url::parse(&url).expect("url");
        let zone = url.query_pairs().find(|(k, _)| k == "timezone").map(|(_, v)| v.into_owned());
        assert_eq!(zone.as_deref(), Some("Etc/GMT+5"));
    }

    #[test]
    fn an_archive_series_is_labelled_in_utc() {
        let body = br#"{"utc_offset_seconds": 7200, "timezone": "Europe/Berlin", "hourly": {
            "time": [1784887200, 1784890800], "temperature_2m": [20.0, 21.0],
            "global_tilted_irradiance_instant": [500.0, null]}}"#;
        let plane = (30.0, 0.0);
        let series =
            assemble(HERE, &[plane], &[(plane, decode_archive(body).expect("decoded"))]).expect("series");
        assert_eq!(series.times, ["2026-07-24T10:00", "2026-07-24T11:00"]);
        assert_eq!((series.utc_offset_seconds, series.gti), (0, vec![vec![500.0, 0.0]]));
    }

    #[test]
    fn an_archive_time_out_of_range_is_refused() {
        let body = br#"{"hourly": {"time": [9223372036854775807], "temperature_2m": [1.0],
            "global_tilted_irradiance_instant": [1.0]}}"#;
        assert!(matches!(decode_archive(body), Err(FetchError::Fields)));
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
        let series =
            assemble(HERE, &planes, &[((30.0, 0.0), first), ((10.0, 90.0), second)]).expect("series");
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

    #[test]
    fn an_empty_or_non_json_body_is_unreadable() {
        for body in [&b""[..], b"<html>bad gateway</html>", b"{\"minutely_15\":"] {
            assert!(matches!(decode(body), Err(FetchError::Json(_))), "{}", String::from_utf8_lossy(body));
        }
    }

    #[test]
    fn an_empty_time_series_is_refused() {
        let plane = (30.0, 0.0);
        let empty = response(json!({"minutely_15": {"time": [], "temperature_2m": [],
            "global_tilted_irradiance_instant": []}}));
        assert!(matches!(assemble(HERE, &[plane], &[(plane, empty)]), Err(FetchError::Fields)));
    }

    #[test]
    fn a_temperature_series_of_another_length_than_the_times_is_refused() {
        let plane = (30.0, 0.0);
        for temperature in [json!([20.0]), json!([20.0, 21.0, 22.0])] {
            let body = response(json!({"minutely_15": {"time": ["a", "b"], "temperature_2m": temperature,
                "global_tilted_irradiance_instant": [1, 2]}}));
            assert!(
                matches!(assemble(HERE, &[plane], &[(plane, body)]), Err(FetchError::Fields)),
                "{temperature}"
            );
        }
    }

    #[test]
    fn misaligned_extras_drop_out_and_all_null_series_read_as_zero() {
        let plane = (30.0, 0.0);
        let body = response(json!({"minutely_15": {"time": ["a", "b"], "temperature_2m": [null, null],
            "global_tilted_irradiance_instant": [null, null], "direct_normal_irradiance_instant": [1, 2, 3],
            "wind_speed_10m": [null, null]}}));
        let series = assemble(HERE, &[plane], &[(plane, body)]).expect("series");
        assert_eq!((series.temperature, series.gti), (vec![0.0, 0.0], vec![vec![0.0, 0.0]]));
        assert_eq!((series.dni, series.wind_speed), (None, Some(vec![0.0, 0.0])));
    }
}
