//! The Open-Meteo adapters: keyless. The forecast at 15-minute resolution; the archive, past
//! weather for learning (ADR 17), hourly.

use std::collections::HashMap;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use jiff::civil::Date;
use serde::Deserialize;

use super::{Archive, Detail, Error, Provider, Slot};
use crate::location::Location;

const BASE: &str = "https://api.open-meteo.com/v1/forecast";
const ARCHIVE: &str = "https://archive-api.open-meteo.com/v1/archive";
/// Instantaneous irradiance, as the PV model transposes instants, not interval means.
const VARIABLES: &str = "shortwave_radiation_instant,direct_normal_irradiance_instant,\
                         diffuse_radiation_instant,temperature_2m,wind_speed_10m,weather_code,\
                         precipitation,snowfall";
/// The archive has no visibility (ADR 23).
const VISIBILITY: &str = "visibility";
const DETAIL: &str = "relative_humidity_2m,wind_direction_10m,wind_gusts_10m,\
                      apparent_temperature,sunshine_duration";
/// The forecast has these hourly only.
const HOURLY: &str = "cloud_cover,snow_depth";
const TIMEOUT: Duration = Duration::from_secs(30);

/// Fetches from `api.open-meteo.com`.
#[derive(Debug, Clone, Copy, Default)]
pub struct OpenMeteo;

impl Provider for OpenMeteo {
    async fn fetch(&self, location: Location) -> Result<Vec<Slot>, Error> {
        let url = url(location);
        let body = tokio::task::spawn_blocking(move || get(&url))
            .await
            .map_err(|e| Error::Fetch(e.to_string()))??;
        parse(&body)
    }
}

/// Fetches from `archive-api.open-meteo.com`.
#[derive(Debug, Clone, Copy, Default)]
pub struct OpenMeteoArchive;

impl Archive for OpenMeteoArchive {
    async fn fetch(&self, location: Location, from: Date, to: Date) -> Result<Vec<Slot>, Error> {
        let url = archive_url(location, from, to);
        let body = tokio::task::spawn_blocking(move || get(&url))
            .await
            .map_err(|e| Error::Fetch(e.to_string()))??;
        parse_archive(&body)
    }
}

fn get(url: &str) -> Result<String, Error> {
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(TIMEOUT))
        .build()
        .into();
    agent
        .get(url)
        .call()
        .and_then(|mut response| response.body_mut().read_to_string())
        .map_err(|e| Error::Fetch(e.to_string()))
}

/// The request for today and two more days in the location's own timezone, at 0.01°.
pub fn url(location: Location) -> String {
    format!(
        "{BASE}?latitude={:.2}&longitude={:.2}\
         &minutely_15={VARIABLES},{VISIBILITY},{DETAIL}&hourly={HOURLY}&wind_speed_unit=ms&timezone=auto&timeformat=unixtime&forecast_days=3",
        location.latitude, location.longitude
    )
}

/// The request for the UTC days `from` to `to`, at 0.01°.
pub fn archive_url(location: Location, from: Date, to: Date) -> String {
    format!(
        "{ARCHIVE}?latitude={:.2}&longitude={:.2}&start_date={from}&end_date={to}\
         &hourly={VARIABLES},{DETAIL},{HOURLY}&wind_speed_unit=ms&timezone=GMT&timeformat=unixtime",
        location.latitude, location.longitude
    )
}

#[derive(Deserialize)]
struct Body {
    minutely_15: Series,
    #[serde(default)]
    hourly: Option<Hourly>,
}

/// What the forecast has only hourly.
#[derive(Deserialize)]
struct Hourly {
    time: Vec<u64>,
    #[serde(default)]
    cloud_cover: Vec<Option<f64>>,
    #[serde(default)]
    snow_depth: Vec<Option<f64>>,
}

#[derive(Deserialize)]
struct ArchiveBody {
    hourly: Series,
}

#[derive(Deserialize)]
struct Series {
    time: Vec<u64>,
    #[serde(rename = "shortwave_radiation_instant")]
    ghi: Vec<Option<f64>>,
    #[serde(rename = "direct_normal_irradiance_instant")]
    dni: Vec<Option<f64>>,
    #[serde(rename = "diffuse_radiation_instant")]
    dhi: Vec<Option<f64>>,
    #[serde(rename = "temperature_2m")]
    temperature: Vec<Option<f64>>,
    #[serde(rename = "wind_speed_10m")]
    wind: Vec<Option<f64>>,
    #[serde(default, rename = "weather_code")]
    code: Vec<Option<f64>>,
    /// A sum over the slot.
    #[serde(default)]
    precipitation: Vec<Option<f64>>,
    /// A sum over the slot.
    #[serde(default)]
    snowfall: Vec<Option<f64>>,
    #[serde(default)]
    visibility: Vec<Option<f64>>,
    #[serde(default, rename = "relative_humidity_2m")]
    humidity: Vec<Option<f64>>,
    #[serde(default, rename = "wind_direction_10m")]
    wind_direction: Vec<Option<f64>>,
    #[serde(default, rename = "wind_gusts_10m")]
    gusts: Vec<Option<f64>>,
    #[serde(default)]
    apparent_temperature: Vec<Option<f64>>,
    #[serde(default, rename = "sunshine_duration")]
    sunshine: Vec<Option<f64>>,
    #[serde(default)]
    cloud_cover: Vec<Option<f64>>,
    #[serde(default)]
    snow_depth: Vec<Option<f64>>,
}

/// The slots of an answer, its sums over 15 minutes as rates per hour; a slot missing anything
/// the PV model reads but wind is dropped. Sunshine is summed into hours (ADR 23), and cloud
/// cover and snow depth join the slots at whole hours.
pub fn parse(body: &str) -> Result<Vec<Slot>, Error> {
    let Body {
        minutely_15: s,
        hourly,
    } = serde_json::from_str(body).map_err(|_| Error::Format)?;
    let mut slots = slots(&s, 4.0);
    let sunshine = sunshine_by_hour(&s);
    for slot in &mut slots {
        slot.detail.sunshine = sunshine.get(&slot.target).copied();
    }
    if let Some(h) = hourly {
        for (i, &seconds) in h.time.iter().enumerate() {
            let target = UNIX_EPOCH + Duration::from_secs(seconds);
            if let Some(slot) = slots.iter_mut().find(|s| s.target == target) {
                slot.detail.cloud_cover = value(&h.cloud_cover, i);
                slot.detail.snow_depth = value(&h.snow_depth, i);
            }
        }
    }
    Ok(slots)
}

/// The slots of an archive answer; a slot missing anything but wind is dropped, as the archive
/// leaves its latest days empty until they settle.
///
/// # Errors
/// The body is not an archive answer.
pub fn parse_archive(body: &str) -> Result<Vec<Slot>, Error> {
    let ArchiveBody { hourly: s } = serde_json::from_str(body).map_err(|_| Error::Format)?;
    Ok(slots(&s, 1.0))
}

/// Seconds of sunshine in the hour that ends at each whole UTC hour, as the archive has them:
/// each value is of the 15 minutes before its time, so an hour is the four up to it. An hour
/// missing one has none.
fn sunshine_by_hour(s: &Series) -> HashMap<SystemTime, f64> {
    const QUARTER: u64 = 900;
    s.time
        .iter()
        .enumerate()
        .filter(|(_, seconds)| *seconds % 3600 == 0)
        .filter_map(|(i, &end)| {
            let first = i.checked_sub(3)?;
            // Four quarters in a row.
            (s.time.get(first)? + 3 * QUARTER == end).then_some(())?;
            let sum = (first..=i)
                .map(|q| value(&s.sunshine, q))
                .sum::<Option<f64>>()?;
            Some((UNIX_EPOCH + Duration::from_secs(end), sum))
        })
        .collect()
}

fn value(series: &[Option<f64>], i: usize) -> Option<f64> {
    series.get(i).copied().flatten()
}

/// The slots of `s`, whose sums are over `1 / per_hour` hours.
fn slots(s: &Series, per_hour: f64) -> Vec<Slot> {
    s.time
        .iter()
        .enumerate()
        .filter_map(|(i, &seconds)| {
            Some(Slot {
                target: UNIX_EPOCH + Duration::from_secs(seconds),
                ghi: value(&s.ghi, i)?,
                dni: value(&s.dni, i)?,
                dhi: value(&s.dhi, i)?,
                temperature: value(&s.temperature, i)?,
                wind: value(&s.wind, i),
                detail: Detail {
                    code: value(&s.code, i),
                    precipitation: value(&s.precipitation, i).map(|v| v * per_hour),
                    snowfall: value(&s.snowfall, i).map(|v| v * per_hour),
                    visibility: value(&s.visibility, i),
                    humidity: value(&s.humidity, i),
                    wind_direction: value(&s.wind_direction, i),
                    gusts: value(&s.gusts, i),
                    apparent_temperature: value(&s.apparent_temperature, i),
                    sunshine: value(&s.sunshine, i),
                    cloud_cover: value(&s.cloud_cover, i),
                    snow_depth: value(&s.snow_depth, i),
                },
            })
        })
        .collect()
}
