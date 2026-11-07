//! Current conditions for the dashboard tile (3.x `forecast/weather.ts`): Open-Meteo's current temperature
//! and WMO code mapped to a coarse condition, and today's plant-zone shortwave radiation sum, refreshed off the
//! request path ([`crate::refresh`]) per location and plant day. A failed fetch keeps the last reading for the
//! same location; a reading cut on an earlier plant day serves no radiation sum until a fetch lands (3.x served
//! yesterday's sum past midnight).

use std::time::Duration;

use rustls::pki_types::CertificateDer;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::https::{GetError, Limits, get_with_roots};
use crate::plant_zone::plant_zone;
use crate::refresh::{PERIOD, within};
use crate::store::{Store, StoreError};
use crate::weather;

const LIMITS: Limits = Limits { timeout: Duration::from_secs(8), max_bytes: 64 << 10 };

/// Coarse condition buckets the web maps to an icon.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "kebab-case")]
pub enum Icon {
    Clear,
    PartlyCloudy,
    Cloudy,
    Fog,
    Drizzle,
    Rain,
    Snow,
    Thunder,
}

#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Reading {
    pub temperature: f64,
    pub unit: String,
    /// WMO weather interpretation code.
    pub code: i64,
    pub condition: &'static str,
    pub icon: Icon,
    /// Today's shortwave radiation sum in the plant zone, MJ/m²; null when no fetch has landed since the plant
    /// day began.
    #[schema(required = true)]
    pub solar_radiation_sum: Option<f64>,
    pub label: String,
}

#[derive(Debug, thiserror::Error)]
pub enum FetchError {
    #[error(transparent)]
    Get(#[from] GetError),
    #[error("unreadable response: {0}")]
    Json(#[from] serde_json::Error),
    #[error("missing current fields")]
    Fields,
}

#[derive(Debug, Default, Deserialize)]
struct Current {
    temperature_2m: Option<f64>,
    weather_code: Option<i64>,
}

#[derive(Debug, Default, Deserialize)]
struct Units {
    temperature_2m: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
struct Daily {
    time: Option<Vec<String>>,
    shortwave_radiation_sum: Option<Vec<Option<f64>>>,
}

#[derive(Debug, Deserialize)]
struct Response {
    current: Option<Current>,
    current_units: Option<Units>,
    daily: Option<Daily>,
}

/// WMO weather interpretation code → condition and icon.
fn interpret(code: i64) -> (&'static str, Icon) {
    match code {
        0 => ("Clear sky", Icon::Clear),
        1 => ("Mainly clear", Icon::Clear),
        2 => ("Partly cloudy", Icon::PartlyCloudy),
        3 => ("Overcast", Icon::Cloudy),
        45 | 48 => ("Fog", Icon::Fog),
        51..=57 => ("Drizzle", Icon::Drizzle),
        61..=67 => ("Rain", Icon::Rain),
        71..=77 => ("Snow", Icon::Snow),
        80..=82 => ("Rain showers", Icon::Rain),
        85 | 86 => ("Snow showers", Icon::Snow),
        95..=99 => ("Thunderstorm", Icon::Thunder),
        _ => ("Unknown", Icon::Cloudy),
    }
}

/// The reading in `body`, unlabelled; the radiation sum only when its row is dated `today`.
fn reading(body: &[u8], today: jiff::civil::Date) -> Result<Reading, FetchError> {
    let response: Response = serde_json::from_slice(body)?;
    let current = response.current.unwrap_or_default();
    let (Some(temperature), Some(code)) = (current.temperature_2m, current.weather_code) else {
        return Err(FetchError::Fields);
    };
    let (condition, icon) = interpret(code);
    let daily = response.daily.unwrap_or_default();
    let dated_today = daily.time.unwrap_or_default().first().is_some_and(|t| *t == today.to_string());
    let sums = daily.shortwave_radiation_sum.filter(|_| dated_today).unwrap_or_default();
    Ok(Reading {
        temperature,
        unit: response.current_units.and_then(|u| u.temperature_2m).unwrap_or_else(|| "°C".into()),
        code,
        condition,
        icon,
        solar_radiation_sum: sums.first().copied().flatten(),
        label: String::new(),
    })
}

/// A date in a named plant zone: the same date in another zone is another day.
type PlantDay = (String, jiff::civil::Date);

/// The reading the last refresh landed; requests only read it.
#[derive(Debug)]
pub struct Conditions {
    url: String,
    cache: std::sync::Mutex<Option<Cached>>,
}

#[derive(Debug)]
struct Cached {
    key: String,
    fetched_ms: i64,
    /// The plant day the radiation sum belongs to.
    day: PlantDay,
    reading: Reading,
}

/// What the stored settings ask for at one instant.
struct Wanted {
    label: String,
    key: String,
    today: PlantDay,
    url: String,
}

impl Conditions {
    /// Fetching from `url`, Open-Meteo's forecast endpoint or a stand-in.
    pub fn new(url: String) -> Self {
        Self { url, cache: std::sync::Mutex::default() }
    }

    /// None while weather is off or unlocated, and until a reading for the location landed.
    pub async fn serve(&self, store: &Store, now_ms: i64) -> Result<Option<Reading>, StoreError> {
        let Some(wanted) = self.wanted(store, now_ms).await? else { return Ok(None) };
        let cache = self.cache.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        Ok(cache.as_ref().filter(|c| c.key == wanted.key).map(|c| Reading {
            solar_radiation_sum: c.reading.solar_radiation_sum.filter(|_| c.day == wanted.today),
            label: wanted.label,
            ..c.reading.clone()
        }))
    }

    /// Fetches the reading the settings ask for unless one for the same location and plant day landed inside
    /// the refresh period. False when the fetch failed: the last reading is kept.
    pub async fn refresh(
        &self,
        store: &Store,
        roots: &[CertificateDer<'static>],
        now_ms: i64,
    ) -> Result<bool, StoreError> {
        let Some(Wanted { key, today, url, .. }) = self.wanted(store, now_ms).await? else { return Ok(true) };
        let fresh = |c: &Cached| c.key == key && c.day == today && within(PERIOD, c.fetched_ms, now_ms);
        if self.cache.lock().unwrap_or_else(std::sync::PoisonError::into_inner).as_ref().is_some_and(fresh) {
            return Ok(true);
        }
        match fetch(&url, roots, today.1).await {
            Ok(reading) => {
                let landed = Cached { key, fetched_ms: now_ms, day: today, reading };
                *self.cache.lock().unwrap_or_else(std::sync::PoisonError::into_inner) = Some(landed);
                Ok(true)
            }
            Err(error) => {
                tracing::warn!(%error, "weather fetch failed");
                Ok(false)
            }
        }
    }

    async fn wanted(&self, store: &Store, now_ms: i64) -> Result<Option<Wanted>, StoreError> {
        let config = weather::read(store).await?;
        let (true, Some(latitude), Some(longitude)) = (config.enabled, config.latitude, config.longitude)
        else {
            return Ok(None);
        };
        let at = jiff::Timestamp::from_millisecond(now_ms).unwrap_or(jiff::Timestamp::UNIX_EPOCH);
        let zone = plant_zone(store).await?;
        // Open-Meteo cuts the daily sum in the zone it is asked for, on its own clock unless the day is pinned.
        let tz = query_value(zone.iana_name().unwrap_or("UTC"));
        let date = at.to_zoned(zone).date();
        let url = format!(
            "{}?latitude={latitude}&longitude={longitude}&current=temperature_2m,weather_code\
             &daily=shortwave_radiation_sum&timezone={tz}&start_date={date}&end_date={date}",
            self.url
        );
        let key = format!("{latitude},{longitude}");
        Ok(Some(Wanted { label: config.label, key, today: (tz, date), url }))
    }
}

/// `name` percent-encoded outside RFC 3986's unreserved set.
fn query_value(name: &str) -> String {
    name.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => char::from(b).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

async fn fetch(
    url: &str,
    roots: &[CertificateDer<'static>],
    today: jiff::civil::Date,
) -> Result<Reading, FetchError> {
    reading(&get_with_roots(url, LIMITS, roots).await?, today)
}

#[cfg(test)]
mod tests {
    use serde_json::{Value, json};

    use super::*;

    const TODAY: jiff::civil::Date = jiff::civil::date(2026, 7, 24);

    fn body(over: &Value) -> Vec<u8> {
        let mut body = json!({
            "current": {"temperature_2m": 18.4, "weather_code": 61},
            "current_units": {"temperature_2m": "°C"},
            "daily": {"time": ["2026-07-24"], "shortwave_radiation_sum": [12.5]}
        });
        for (key, value) in over.as_object().expect("object") {
            body[key] = value.clone();
        }
        serde_json::to_vec(&body).expect("body")
    }

    fn code(code: i64) -> Reading {
        reading(&body(&json!({"current": {"temperature_2m": 1, "weather_code": code}})), TODAY)
            .expect("reading")
    }

    #[test]
    fn an_open_meteo_answer_maps_to_a_reading() {
        assert_eq!(
            reading(&body(&json!({})), TODAY).expect("reading"),
            Reading {
                temperature: 18.4,
                unit: "°C".into(),
                code: 61,
                condition: "Rain",
                icon: Icon::Rain,
                solar_radiation_sum: Some(12.5),
                label: String::new(),
            }
        );
    }

    #[test]
    fn the_wmo_ranges_map_at_their_ends_and_an_unlisted_code_is_unknown() {
        let seen = |c| {
            let r = code(c);
            (r.condition, r.icon)
        };
        for (codes, want) in [
            (&[0][..], ("Clear sky", Icon::Clear)),
            (&[1], ("Mainly clear", Icon::Clear)),
            (&[2], ("Partly cloudy", Icon::PartlyCloudy)),
            (&[3], ("Overcast", Icon::Cloudy)),
            (&[45, 48], ("Fog", Icon::Fog)),
            (&[51, 57], ("Drizzle", Icon::Drizzle)),
            (&[61, 67], ("Rain", Icon::Rain)),
            (&[71, 77], ("Snow", Icon::Snow)),
            (&[80, 82], ("Rain showers", Icon::Rain)),
            (&[85, 86], ("Snow showers", Icon::Snow)),
            (&[95, 99], ("Thunderstorm", Icon::Thunder)),
        ] {
            for &c in codes {
                assert_eq!(seen(c), want, "code {c}");
            }
        }
        for unlisted in [-1, 4, 44, 46, 50, 58, 60, 68, 70, 78, 79, 83, 84, 87, 94, 100] {
            assert_eq!(seen(unlisted), ("Unknown", Icon::Cloudy), "code {unlisted}");
        }
    }

    #[test]
    fn a_missing_unit_and_an_absent_null_or_empty_radiation_sum_fall_back() {
        let missing_unit = reading(&body(&json!({"current_units": null})), TODAY).expect("reading");
        assert_eq!(missing_unit.unit, "°C");
        for daily in [
            json!(null),
            json!({"time": ["2026-07-24"], "shortwave_radiation_sum": [null]}),
            json!({"time": ["2026-07-24"], "shortwave_radiation_sum": []}),
        ] {
            let r = reading(&body(&json!({"daily": daily})), TODAY).expect("reading");
            assert_eq!(r.solar_radiation_sum, None, "{daily}");
        }
    }

    #[test]
    fn a_radiation_sum_dated_another_day_or_undated_is_no_sum() {
        for time in [json!(["2026-07-23"]), json!(["2026-07-25"]), json!([]), json!(null)] {
            let r =
                reading(&body(&json!({"daily": {"time": time, "shortwave_radiation_sum": [12.5]}})), TODAY)
                    .expect("reading");
            assert_eq!((r.solar_radiation_sum, r.temperature, r.icon), (None, 18.4, Icon::Rain), "{time}");
        }
    }

    #[test]
    fn zero_degrees_and_code_zero_are_a_reading() {
        let r = reading(&body(&json!({"current": {"temperature_2m": 0, "weather_code": 0}})), TODAY)
            .expect("reading");
        assert_eq!((r.temperature, r.code), (0.0, 0));
    }

    #[test]
    fn a_negative_temperature_is_a_reading() {
        let r = reading(&body(&json!({"current": {"temperature_2m": -7.5, "weather_code": 71}})), TODAY)
            .expect("reading");
        assert_eq!((r.temperature, r.icon), (-7.5, Icon::Snow));
    }

    #[test]
    fn a_zone_name_is_percent_encoded_for_the_query() {
        for (name, want) in [
            ("UTC", "UTC"),
            ("Europe/Berlin", "Europe%2FBerlin"),
            ("Etc/GMT+1", "Etc%2FGMT%2B1"),
            ("America/Port-au-Prince", "America%2FPort-au-Prince"),
            ("America/North_Dakota/New_Salem", "America%2FNorth_Dakota%2FNew_Salem"),
        ] {
            assert_eq!(query_value(name), want, "{name}");
        }
    }

    #[test]
    fn an_answer_without_the_current_temperature_or_code_is_refused() {
        for current in [json!(null), json!({"temperature_2m": 1}), json!({"weather_code": 1})] {
            assert!(
                matches!(reading(&body(&json!({"current": current})), TODAY), Err(FetchError::Fields)),
                "{current}"
            );
        }
        assert!(matches!(reading(b"not json", TODAY), Err(FetchError::Json(_))));
    }
}
