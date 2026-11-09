//! The energy-charts adapter (Fraunhofer ISE): keyless day-ahead prices at 15 minutes, licensed
//! CC BY 4.0 from Bundesnetzagentur | SMARD.de, so the SPA shows the attribution.

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Deserialize;

use super::{BiddingZone, Error, Provider, Slot};
use crate::profiles::{Fetch as _, Https};

const BASE: &str = "https://api.energy-charts.info/price";
const UNIT: &str = "EUR / MWh";

/// Fetches from `api.energy-charts.info`.
#[derive(Debug, Clone, Copy, Default)]
pub struct EnergyCharts;

impl Provider for EnergyCharts {
    async fn fetch(&self, zone: BiddingZone, at: SystemTime) -> Result<Vec<Slot>, Error> {
        let url = url(zone, at);
        let body = tokio::task::spawn_blocking(move || Https.get(&url))
            .await
            .map_err(|e| Error::Fetch(e.to_string()))?
            .map_err(Error::Fetch)?;
        parse(&String::from_utf8_lossy(&body))
    }
}

/// The request for today and tomorrow on the market's calendar at `at`; `end` is inclusive, and a
/// range past the last published slot answers what is published.
pub fn url(zone: BiddingZone, at: SystemTime) -> String {
    let today = jiff::Timestamp::try_from(at)
        .unwrap_or(jiff::Timestamp::UNIX_EPOCH)
        .to_zoned(jiff::tz::TimeZone::get(zone.market_zone()).unwrap_or(jiff::tz::TimeZone::UTC))
        .date();
    let tomorrow = today.tomorrow().unwrap_or(today);
    format!("{BASE}?bzn={}&start={today}&end={tomorrow}", zone.code())
}

#[derive(Deserialize)]
struct Body {
    unix_seconds: Vec<u64>,
    price: Vec<Option<f64>>,
    unit: String,
}

/// The slots of an answer in EUR/kWh; a slot without a price is unknown and dropped.
pub fn parse(body: &str) -> Result<Vec<Slot>, Error> {
    let body: Body = serde_json::from_str(body).map_err(|_| Error::Format)?;
    if body.unit != UNIT {
        return Err(Error::Format);
    }
    Ok(body
        .unix_seconds
        .iter()
        .zip(&body.price)
        .filter_map(|(&seconds, &price)| {
            Some(Slot {
                start: UNIX_EPOCH + Duration::from_secs(seconds),
                price: price? / 1000.0,
            })
        })
        .collect())
}
