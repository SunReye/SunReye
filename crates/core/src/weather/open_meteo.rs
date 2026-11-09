//! The Open-Meteo adapters: keyless. The forecast at 15-minute resolution; the archive, past
//! weather for learning (ADR 17), hourly.

use std::time::{Duration, UNIX_EPOCH};

use jiff::civil::Date;
use serde::Deserialize;

use super::{Archive, Error, Provider, Slot};
use crate::location::Location;

const BASE: &str = "https://api.open-meteo.com/v1/forecast";
const ARCHIVE: &str = "https://archive-api.open-meteo.com/v1/archive";
/// Instantaneous irradiance, as the PV model transposes instants, not interval means.
const VARIABLES: &str = "shortwave_radiation_instant,direct_normal_irradiance_instant,\
                         diffuse_radiation_instant,temperature_2m,wind_speed_10m";
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
        "{BASE}?latitude={:.2}&longitude={:.2}&minutely_15={VARIABLES}\
         &wind_speed_unit=ms&timezone=auto&timeformat=unixtime&forecast_days=3",
        location.latitude, location.longitude
    )
}

/// The request for the UTC days `from` to `to`, at 0.01°.
pub fn archive_url(location: Location, from: Date, to: Date) -> String {
    format!(
        "{ARCHIVE}?latitude={:.2}&longitude={:.2}&start_date={from}&end_date={to}\
         &hourly={VARIABLES}&wind_speed_unit=ms&timezone=GMT&timeformat=unixtime",
        location.latitude, location.longitude
    )
}

#[derive(Deserialize)]
struct Body {
    minutely_15: Series,
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
}

/// The slots of an answer; a slot missing anything but wind is dropped.
pub fn parse(body: &str) -> Result<Vec<Slot>, Error> {
    let Body { minutely_15: s } = serde_json::from_str(body).map_err(|_| Error::Format)?;
    Ok(slots(&s))
}

/// The slots of an archive answer; a slot missing anything but wind is dropped, as the archive
/// leaves its latest days empty until they settle.
///
/// # Errors
/// The body is not an archive answer.
pub fn parse_archive(body: &str) -> Result<Vec<Slot>, Error> {
    let ArchiveBody { hourly: s } = serde_json::from_str(body).map_err(|_| Error::Format)?;
    Ok(slots(&s))
}

fn slots(s: &Series) -> Vec<Slot> {
    let value = |series: &[Option<f64>], i: usize| series.get(i).copied().flatten();
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
            })
        })
        .collect()
}
