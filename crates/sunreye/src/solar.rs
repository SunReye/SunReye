//! The forecast served (3.x `fetchSolarForecast`): the settings composed, Open-Meteo irradiance cached
//! 30 minutes per location and planes, the clipping sim's inputs read from the store, the model rebuilt
//! per request, scaled by the learned correction while it is enabled. A failed fetch keeps the last irradiance
//! for the same key and reports it stale.

use jiff::civil::DateTime;
use jiff::tz::TimeZone;
use tokio::sync::Mutex;

use crate::forecast::{self, Forecast, Irradiance, Location, Run, SimInputs};
use crate::open_meteo::{self, Plane};
use crate::plant_zone;
use crate::rollup::Tier;
use crate::run::Core;
use crate::store::{BucketWindow, StoreError, first_in_service};
use crate::weather::{self, OPEN_METEO, WeatherConfig};

const TTL_MS: i64 = 30 * 60_000;
/// House load moves slowly: its median is read far less often than the irradiance.
const LOAD_TTL_MS: i64 = 6 * 3_600_000;
const LOAD_DAYS: i64 = 14;
const HOUR_MS: i64 = 3_600_000;

/// The one cached series and the house-load median.
#[derive(Debug)]
pub struct Solar {
    url: String,
    cache: Mutex<Option<Cached>>,
    load: std::sync::Mutex<Option<(i64, Option<f64>)>>,
}

#[derive(Debug)]
struct Cached {
    key: String,
    fetched_ms: i64,
    data: Irradiance,
}

/// A forecast and the age of the irradiance it was built from.
#[derive(Debug)]
pub struct Served {
    pub forecast: Forecast,
    pub fetched_ms: i64,
    /// The last fetch failed; this is the irradiance from before it.
    pub stale: bool,
}

impl Solar {
    /// Fetching from `url`, Open-Meteo's forecast endpoint or a stand-in.
    pub fn new(url: String) -> Self {
        Self { url, cache: Mutex::new(None), load: std::sync::Mutex::new(None) }
    }

    /// None while the forecast is off, unlocated or without arrays, and when no irradiance can be had.
    pub async fn serve(&self, core: &Core) -> Result<Option<Served>, StoreError> {
        let config = weather::read(&core.store).await?;
        let Some(wanted) = wanted(&config) else { return Ok(None) };
        let now_ms = core.now_ms();
        let mut cache = self.cache.lock().await;
        let Some(stale) = self.refresh(&mut cache, core, wanted, now_ms).await else { return Ok(None) };
        let Some(hit) = cache.as_ref() else { return Ok(None) };
        let sim = self.sim_inputs(core, &config, &hit.data, now_ms).await?;
        let correction = if config.forecast.correction.enabled {
            crate::learn::stored(&core.store).await?.map(|(model, _)| model).filter(|m| !m.is_empty())
        } else {
            None
        };
        let zone = plant_zone::plant_zone(&core.store).await?;
        let run = Run { time_zone: &zone, now_ms, sim, correction: correction.as_ref() };
        let built = forecast::build(&config.model(), &hit.data, OPEN_METEO, &run);
        let built = built.inspect_err(|error| tracing::warn!(%error, "forecast series unusable")).ok();
        Ok(built.map(|forecast| Served { forecast, fetched_ms: hit.fetched_ms, stale }))
    }

    /// Fetches unless the cache holds `wanted` inside the TTL. `Some(stale)` when the cache now holds it.
    async fn refresh(
        &self,
        cache: &mut Option<Cached>,
        core: &Core,
        wanted: Wanted,
        now_ms: i64,
    ) -> Option<bool> {
        let held = cache.as_ref().filter(|c| c.key == wanted.key).map(|c| c.fetched_ms);
        if held.is_some_and(|fetched_ms| now_ms - fetched_ms < TTL_MS) {
            return Some(false);
        }
        let fetched = open_meteo::fetch(&self.url, &core.roots, wanted.location, &wanted.planes).await;
        let Ok(fetched) = fetched.inspect_err(|error| tracing::warn!(%error, "forecast fetch failed")) else {
            return held.map(|_| true);
        };
        *cache = Some(Cached { key: wanted.key, fetched_ms: now_ms, data: fetched });
        Some(false)
    }

    /// Live SOC, house load and day-start SOC from the first in-service device, read only when a feed-in
    /// cap or a battery can clip.
    async fn sim_inputs(
        &self,
        core: &Core,
        config: &WeatherConfig,
        data: &Irradiance,
        now_ms: i64,
    ) -> Result<SimInputs, StoreError> {
        let f = &config.forecast;
        if f.max_output_w.is_none() && f.battery.is_none() {
            return Ok(SimInputs::default());
        }
        let devices = core.store.devices().await?;
        let Some(device) = first_in_service(&devices) else {
            return Ok(SimInputs { house_load_w: f.house_load_w, ..SimInputs::default() });
        };
        let profile = core.profile(&device.profile_id).await?;
        let key = |role: &str| {
            let metrics = profile.as_ref().map(|p| p.metrics.as_slice()).unwrap_or_default();
            metrics.iter().find(|m| m.role.as_deref() == Some(role)).map(|m| m.key.clone())
        };
        let (soc, load) = (key("battery.soc"), key("load.power"));
        let latest = core.unstored.held(device.id).pop();
        let start_soc_pct = soc.as_ref().and_then(|soc| {
            latest?.values.into_iter().find(|(k, _)| k == soc).map(|(_, v)| v).filter(|v| v.is_finite())
        });
        let house_load_w = match (f.house_load_w, load) {
            (Some(watts), _) => Some(watts),
            (None, Some(load)) => self.median_load(core, device.id, &load, now_ms).await?,
            (None, None) => None,
        };
        let day_start_soc_pct = match (&f.battery, soc) {
            (Some(_), Some(soc)) => day_start_soc(core, device.id, &soc, data).await?,
            _ => None,
        };
        Ok(SimInputs { start_soc_pct, house_load_w, day_start_soc_pct })
    }

    /// The median hourly average over 14 days, recomputed once past its TTL.
    async fn median_load(
        &self,
        core: &Core,
        device: i64,
        metric: &str,
        now_ms: i64,
    ) -> Result<Option<f64>, StoreError> {
        let held = *self.load.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        if let Some((_, watts)) = held.filter(|(at_ms, _)| now_ms - at_ms < LOAD_TTL_MS) {
            return Ok(watts);
        }
        let window = hours(now_ms - LOAD_DAYS * 24 * HOUR_MS, now_ms + HOUR_MS, LOAD_DAYS * 24 + 1);
        let buckets = core.store.buckets_between(Tier::Hour, device, metric, window).await?;
        let watts = median(buckets.iter().map(|b| b.avg).filter(|v| v.is_finite()).collect());
        *self.load.lock().unwrap_or_else(std::sync::PoisonError::into_inner) = Some((now_ms, watts));
        Ok(watts)
    }
}

/// What one fetch asks for and the cache key it is held under.
struct Wanted {
    key: String,
    location: Location,
    planes: Vec<Plane>,
}

/// None unless the forecast is ready and its provider is one the core fetches.
fn wanted(config: &WeatherConfig) -> Option<Wanted> {
    let location = config.forecast_ready()?;
    if config.forecast.provider != OPEN_METEO {
        tracing::warn!(provider = config.forecast.provider, "unknown forecast provider");
        return None;
    }
    let planes: Vec<Plane> = config.forecast.arrays.iter().map(|a| (a.tilt, a.azimuth)).collect();
    let key = format!("{}/{}/{planes:?}", location.latitude, location.longitude);
    Some(Wanted { key, location, planes })
}

fn hours(from_ms: i64, to_ms: i64, limit: i64) -> BucketWindow {
    let at = |ms| jiff::Timestamp::from_millisecond(ms).unwrap_or(jiff::Timestamp::UNIX_EPOCH);
    BucketWindow { from: at(from_ms), to: at(to_ms), limit: u32::try_from(limit).unwrap_or(u32::MAX) }
}

/// Measured SOC in the hour the series opens, from the hourly rollup.
async fn day_start_soc(
    core: &Core,
    device: i64,
    soc: &str,
    data: &Irradiance,
) -> Result<Option<f64>, StoreError> {
    let Some(first) = data.times.first().and_then(|t| t.parse::<DateTime>().ok()) else { return Ok(None) };
    let Ok(utc) = first.to_zoned(TimeZone::UTC) else { return Ok(None) };
    let start_ms = utc.timestamp().as_millisecond() - i64::from(data.utc_offset_seconds) * 1000;
    let buckets =
        core.store.buckets_between(Tier::Hour, device, soc, hours(start_ms, start_ms + HOUR_MS, 1)).await?;
    Ok(buckets.first().map(|b| b.avg).filter(|v| v.is_finite()))
}

/// Interpolated between the middle two of an even count, as Postgres `percentile_cont(0.5)`.
fn median(mut values: Vec<f64>) -> Option<f64> {
    values.sort_by(f64::total_cmp);
    let mid = values.len() / 2;
    match values.len() {
        0 => None,
        n if n % 2 == 1 => values.get(mid).copied(),
        _ => Some(f64::midpoint(values[mid - 1], values[mid])),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_median_interpolates_an_even_count_and_none_has_none() {
        assert_eq!(median(vec![]), None);
        assert_eq!(median(vec![7.0]), Some(7.0));
        assert_eq!(median(vec![300.0, 100.0, 200.0]), Some(200.0));
        assert_eq!(median(vec![400.0, 100.0, 300.0, 200.0]), Some(250.0));
    }
}
