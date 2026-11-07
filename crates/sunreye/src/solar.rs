//! The forecast served (3.x `fetchSolarForecast`): the settings composed, Open-Meteo irradiance refreshed off
//! the request path ([`crate::refresh`]) per location and planes, the clipping sim's inputs read from the store,
//! the model rebuilt per request, scaled by the learned correction while it is enabled. A failed fetch keeps the
//! last irradiance for the same key and reports it stale.

use std::sync::Arc;
use std::time::Duration;

use jiff::civil::DateTime;
use jiff::tz::TimeZone;
use rustls::pki_types::CertificateDer;

use crate::forecast::{self, Forecast, Irradiance, Location, Run, SimInputs};
use crate::open_meteo::{self, Plane};
use crate::plant_zone;
use crate::profile::Bundle;
use crate::refresh::{PERIOD, within};
use crate::rollup::Tier;
use crate::run::Clock;
use crate::samples::Unstored;
use crate::sources::{find_profile, installed};
use crate::store::{BucketWindow, OPEN_METEO, Store, StoreError, first_in_service};
use crate::weather::{self, WeatherConfig};

/// House load moves slowly: its median is read far less often than the irradiance.
const LOAD_TTL: Duration = Duration::from_hours(6);
const LOAD_DAYS: i64 = 14;
const HOUR_MS: i64 = 3_600_000;

/// The series the last refresh landed, which requests only read, and the house-load median.
#[derive(Debug)]
pub struct Solar {
    url: String,
    cache: std::sync::Mutex<Option<Cached>>,
    load: std::sync::Mutex<Option<(i64, Option<f64>)>>,
}

#[derive(Debug, Clone)]
struct Cached {
    key: String,
    fetched_ms: i64,
    data: Arc<Irradiance>,
    /// The last fetch for the key failed.
    stale: bool,
}

/// A forecast and the age of the irradiance it was built from.
#[derive(Debug)]
pub struct Served {
    pub forecast: Forecast,
    pub fetched_ms: i64,
    /// The last fetch failed; this is the irradiance from before it.
    pub stale: bool,
    /// The plant zone the daily sums were cut in.
    pub time_zone: String,
}

impl Solar {
    /// Fetching from `url`, Open-Meteo's forecast endpoint or a stand-in.
    pub fn new(url: String) -> Self {
        Self { url, cache: std::sync::Mutex::default(), load: std::sync::Mutex::new(None) }
    }

    /// None while the forecast is off, unlocated or without arrays, and until irradiance for the key landed.
    pub async fn serve(
        &self,
        store: &Store,
        clock: &Clock,
        bundle: &Bundle,
        unstored: &Unstored,
    ) -> Result<Option<Served>, StoreError> {
        let config = weather::read(store).await?;
        let Some(wanted) = wanted(&config) else { return Ok(None) };
        let Some(hit) = self.held().filter(|c| c.key == wanted.key) else { return Ok(None) };
        let now_ms = clock.now_ms();
        let sim = self.sim_inputs(Reads { store, bundle, unstored }, &config, &hit.data, now_ms).await?;
        let (correction, arrays) = if config.forecast.correction.enabled {
            crate::learn::applied(store, &config.forecast.arrays).await?
        } else {
            (None, Vec::new())
        };
        let zone = plant_zone::plant_zone(store).await?;
        let run = Run {
            time_zone: &zone,
            now_ms,
            sim,
            correction: correction.as_ref(),
            array_corrections: &arrays,
        };
        let built = forecast::build(&config.model(), &hit.data, OPEN_METEO, &run);
        let built = built.inspect_err(|error| tracing::warn!(%error, "forecast series unusable")).ok();
        let time_zone = zone.iana_name().unwrap_or("UTC").to_owned();
        Ok(built.map(|forecast| Served { forecast, fetched_ms: hit.fetched_ms, stale: hit.stale, time_zone }))
    }

    /// Fetches the irradiance the settings ask for unless the same key landed inside the refresh period. False
    /// when the fetch failed: the last irradiance is kept and reported stale.
    pub async fn refresh(
        &self,
        store: &Store,
        clock: &Clock,
        roots: &[CertificateDer<'static>],
    ) -> Result<bool, StoreError> {
        let config = weather::read(store).await?;
        let Some(wanted) = wanted(&config) else { return Ok(true) };
        let now_ms = clock.now_ms();
        if self
            .held()
            .is_some_and(|c| c.key == wanted.key && !c.stale && within(PERIOD, c.fetched_ms, now_ms))
        {
            return Ok(true);
        }
        let fetched = open_meteo::fetch(&self.url, roots, wanted.location, &wanted.planes).await;
        Ok(self.land(wanted.key, fetched, clock.now_ms()))
    }

    /// A fetched series replaces the cache; a failed fetch marks the series held for `key` stale.
    fn land(&self, key: String, fetched: Result<Irradiance, open_meteo::FetchError>, now_ms: i64) -> bool {
        let mut cache = self.cache.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        let Ok(data) = fetched.inspect_err(|error| tracing::warn!(%error, "forecast fetch failed")) else {
            if let Some(held) = cache.as_mut().filter(|c| c.key == key) {
                held.stale = true;
            }
            return false;
        };
        *cache = Some(Cached { key, fetched_ms: now_ms, data: Arc::new(data), stale: false });
        true
    }

    fn held(&self) -> Option<Cached> {
        self.cache.lock().unwrap_or_else(std::sync::PoisonError::into_inner).clone()
    }

    /// Live SOC, house load and day-start SOC from the first in-service device, read only when a feed-in
    /// cap or a battery can clip.
    async fn sim_inputs(
        &self,
        Reads { store, bundle, unstored }: Reads<'_>,
        config: &WeatherConfig,
        data: &Irradiance,
        now_ms: i64,
    ) -> Result<SimInputs, StoreError> {
        let f = &config.forecast;
        if f.max_output_w.is_none() && f.battery.is_none() {
            return Ok(SimInputs::default());
        }
        let devices = store.devices().await?;
        let Some(device) = first_in_service(&devices) else {
            return Ok(SimInputs { house_load_w: f.house_load_w, ..SimInputs::default() });
        };
        let profile = find_profile(bundle, &installed(store).await?, &device.profile_id);
        let key = |role: &str| {
            let metrics = profile.as_ref().map(|p| p.metrics.as_slice()).unwrap_or_default();
            metrics.iter().find(|m| m.role.as_deref() == Some(role)).map(|m| m.key.clone())
        };
        let (soc, load) = (key("battery.soc"), key("load.power"));
        let latest = unstored.held(device.id).pop();
        let start_soc_pct = soc.as_ref().and_then(|soc| {
            latest?.values.into_iter().find(|(k, _)| k == soc).map(|(_, v)| v).filter(|v| v.is_finite())
        });
        let house_load_w = match (f.house_load_w, load) {
            (Some(watts), _) => Some(watts),
            (None, Some(load)) => self.median_load(store, device.id, &load, now_ms).await?,
            (None, None) => None,
        };
        let day_start_soc_pct = match (&f.battery, soc) {
            (Some(_), Some(soc)) => day_start_soc(store, device.id, &soc, data).await?,
            _ => None,
        };
        Ok(SimInputs { start_soc_pct, house_load_w, day_start_soc_pct })
    }

    /// The median hourly average over 14 days, recomputed once past its TTL.
    async fn median_load(
        &self,
        store: &Store,
        device: i64,
        metric: &str,
        now_ms: i64,
    ) -> Result<Option<f64>, StoreError> {
        let held = *self.load.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        if let Some((_, watts)) = held.filter(|(at_ms, _)| within(LOAD_TTL, *at_ms, now_ms)) {
            return Ok(watts);
        }
        let window = hours(now_ms - LOAD_DAYS * 24 * HOUR_MS, now_ms + HOUR_MS, LOAD_DAYS * 24 + 1);
        let buckets = store.buckets_between(Tier::Hour, device, metric, window).await?;
        let watts = median(buckets.iter().map(|b| b.avg).filter(|v| v.is_finite()).collect());
        *self.load.lock().unwrap_or_else(std::sync::PoisonError::into_inner) = Some((now_ms, watts));
        Ok(watts)
    }
}

/// Where the clipping sim's live inputs are read.
struct Reads<'a> {
    store: &'a Store,
    bundle: &'a Bundle,
    unstored: &'a Unstored,
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
    store: &Store,
    device: i64,
    soc: &str,
    data: &Irradiance,
) -> Result<Option<f64>, StoreError> {
    let Some(first) = data.times.first().and_then(|t| t.parse::<DateTime>().ok()) else { return Ok(None) };
    let Ok(utc) = first.to_zoned(TimeZone::UTC) else { return Ok(None) };
    let start_ms = utc.timestamp().as_millisecond() - i64::from(data.utc_offset_seconds) * 1000;
    let buckets =
        store.buckets_between(Tier::Hour, device, soc, hours(start_ms, start_ms + HOUR_MS, 1)).await?;
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
    use crate::modbus::Transport;
    use crate::samples::{ClosedMinute, Sample, minute_of};
    use crate::store::{DevicePv, NewConnection, NewDevice, PlantSettings, PvArray, Store};
    use crate::test_net::closed_port;

    const LOAD: &str = "load.power";
    /// 2026-07-24T10:00:00Z.
    const NOW_MS: i64 = 1_784_887_200_000;
    const TTL_MS: i64 = 6 * HOUR_MS;

    async fn load_at(store: &Store, device: i64, at_ms: i64, watts: f64) {
        let samples = vec![Sample { at_ms, values: vec![(LOAD.into(), watts)] }];
        store
            .append_minute(device, &ClosedMinute { minute: minute_of(at_ms), samples })
            .await
            .expect("append");
    }

    async fn with_device() -> (Store, i64) {
        let store = Store::in_memory().await.expect("store");
        let connection = NewConnection {
            transport: Transport::Tcp,
            host: "127.0.0.1".into(),
            port: 1,
            logger_serial: None,
        };
        let connection = store.add_connection(&connection).await.expect("connection");
        let device = NewDevice { connection_id: connection, profile_id: "none".into(), unit_id: 1 };
        let device = store.add_device(&device).await.expect("device");
        (store, device)
    }

    #[tokio::test]
    async fn the_house_load_median_is_read_again_past_its_ttl_and_after_the_clock_stepped_back() {
        let (store, device) = with_device().await;
        let solar = Solar::new(String::new());
        let median = async |now_ms| solar.median_load(&store, device, LOAD, now_ms).await.expect("median");

        load_at(&store, device, NOW_MS - 3 * HOUR_MS, 300.0).await;
        assert_eq!(median(NOW_MS).await, Some(300.0));
        load_at(&store, device, NOW_MS - 2 * HOUR_MS, 500.0).await;
        assert_eq!(median(NOW_MS + TTL_MS - 1).await, Some(300.0), "inside the TTL");
        assert_eq!(median(NOW_MS - 1).await, Some(400.0), "read after the clock stepped back");
        load_at(&store, device, NOW_MS - HOUR_MS, 700.0).await;
        assert_eq!(median(NOW_MS - 2 + TTL_MS).await, Some(400.0), "inside the TTL");
        assert_eq!(median(NOW_MS - 1 + TTL_MS).await, Some(500.0), "at the TTL");
    }

    #[tokio::test]
    async fn a_ready_forecast_over_a_store_and_a_clock_reports_a_dead_fetch_and_serves_nothing() {
        let (store, device) = with_device().await;
        let (clock, bundle, unstored) =
            (Clock::at(NOW_MS), Bundle::official().expect("bundle"), Unstored::default());
        let (_closed, port) = closed_port();
        let solar = Solar::new(format!("https://127.0.0.1:{port}/v1/forecast"));
        assert!(solar.refresh(&store, &clock, &[]).await.expect("refresh"), "off: nothing to fetch");

        let plant = PlantSettings {
            enabled: true,
            latitude: Some(52.5),
            longitude: Some(13.4),
            forecast_enabled: true,
            ..PlantSettings::default()
        };
        store.save_plant_settings(&plant).await.expect("plant");
        let array = PvArray {
            kwp: 5.0,
            tilt: 30.0,
            azimuth: 0.0,
            device_slug: None,
            temp_coefficient: None,
            system_loss: None,
            mppt: None,
        };
        store
            .save_device_pv(device, &DevicePv { arrays: vec![array], ..DevicePv::default() })
            .await
            .expect("pv");
        assert!(!solar.refresh(&store, &clock, &[]).await.expect("refresh"), "nothing answers");
        let served = solar.serve(&store, &clock, &bundle, &unstored).await.expect("serve");
        assert!(served.is_none(), "no irradiance landed");
    }

    #[test]
    fn the_median_interpolates_an_even_count_and_none_has_none() {
        assert_eq!(median(vec![]), None);
        assert_eq!(median(vec![7.0]), Some(7.0));
        assert_eq!(median(vec![300.0, 100.0, 200.0]), Some(200.0));
        assert_eq!(median(vec![400.0, 100.0, 300.0, 200.0]), Some(250.0));
    }
}
