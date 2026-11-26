//! The years and records of the plant (ADR 9, 11): its daily rollups folded by the pure
//! `records` module.

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use axum::Json;
use axum::extract::State;
use jiff::civil::Date;
use jiff::tz::TimeZone;
use serde::Serialize;
use tokio::sync::watch;
use utoipa::ToSchema;

use super::{Clock, Problem, ProblemDetails, internal};
use crate::bus::{DeviceId, Series};
use crate::records::{self, Best, Day, Figures};
use crate::storage::{Aggregate, Reader, Tier};
use crate::{plant, tariff};

/// Every day rolled up, to 2106.
const ALL: Duration = Duration::from_secs(u32::MAX as u64);

pub type RecordsState = State<(Reader, watch::Receiver<TimeZone>, Clock)>;

/// Every recorded plant-local year, newest first, and the plant's records.
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Records {
    years: Vec<YearView>,
    /// The most kWh produced on a closed day.
    best_day: Option<BestView>,
    /// The most kWh produced in a closed month, by its first date.
    best_month: Option<BestView>,
    /// The most EUR saved on a closed day.
    best_saving: Option<BestView>,
}

#[derive(Serialize, ToSchema)]
struct YearView {
    year: i16,
    /// The year today is in, summed to the latest reading.
    running: bool,
    figures: FiguresView,
    /// The year before over the same dates; `null` before the record began.
    before: Option<FiguresView>,
}

/// kWh, and EUR saved. Autarky is `selfSupply / consumption`.
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
struct FiguresView {
    production: f64,
    consumption: f64,
    self_supply: f64,
    /// `null` where no tariff priced a day.
    saved: Option<f64>,
}

#[derive(Serialize, ToSchema)]
struct BestView {
    /// `YYYY-MM-DD`.
    date: String,
    value: f64,
}

impl From<Figures> for FiguresView {
    fn from(f: Figures) -> Self {
        Self {
            production: f.production,
            consumption: f.consumption,
            self_supply: f.self_supply,
            saved: f.saved,
        }
    }
}

impl From<Best> for BestView {
    fn from(b: Best) -> Self {
        Self {
            date: b.date.to_string(),
            value: b.value,
        }
    }
}

/// Each plant-local day's integral of `role`, by date.
async fn daily(
    reader: &Reader,
    device: DeviceId,
    role: &str,
    zone: &TimeZone,
    now: SystemTime,
) -> Result<Vec<(Date, f64)>, Problem> {
    let series = Series {
        role: role.to_owned(),
        index: None,
    };
    let range = UNIX_EPOCH..now.min(UNIX_EPOCH + ALL);
    let rollups = reader
        .rollups(device, &series, Tier::Day, range)
        .await
        .map_err(internal)?;
    Ok(rollups
        .iter()
        .filter_map(|r| match r.aggregate {
            Aggregate::Measurement { integral, .. } => Some((date(r.start, zone)?, integral)),
            Aggregate::Counter { .. } | Aggregate::Held { .. } => None,
        })
        .collect())
}

fn date(time: SystemTime, zone: &TimeZone) -> Option<Date> {
    let instant = jiff::Timestamp::try_from(time).ok()?;
    Some(instant.to_zoned(zone.clone()).date())
}

/// Every recorded year with the same dates of the year before, and the best closed day and
/// month of production and day of savings, from the daily rollups.
#[utoipa::path(get, path = "/api/v1/records", responses(
    (status = 200, body = Records),
    (status = "4XX", body = ProblemDetails, content_type = "application/problem+json"),
))]
pub async fn records(State((reader, zone, clock)): RecordsState) -> Result<Json<Records>, Problem> {
    let zone = zone.borrow().clone();
    let now = clock();
    let read = |device, role| daily(&reader, device, role, &zone, now);
    let (pv, load, supply, saved) = (
        read(plant::DEVICE, "pv.power").await?,
        read(plant::DEVICE, "load.power").await?,
        read(plant::DEVICE, "self.supply.power").await?,
        read(tariff::DEVICE, "cost.savings.rate").await?,
    );
    let mut days: std::collections::BTreeMap<Date, Figures> = std::collections::BTreeMap::new();
    let kwh = |wh: f64| wh / 1000.0;
    for (on, wh) in pv {
        days.entry(on).or_default().production += kwh(wh);
    }
    for (on, wh) in load {
        days.entry(on).or_default().consumption += kwh(wh);
    }
    for (on, wh) in supply {
        days.entry(on).or_default().self_supply += kwh(wh);
    }
    for (on, eur) in saved {
        days.entry(on).or_default().saved = Some(eur);
    }
    let days: Vec<Day> = days
        .into_iter()
        .map(|(date, figures)| Day { date, figures })
        .collect();
    let found = records::records(&days, date(now, &zone).unwrap_or_default());
    Ok(Json(Records {
        years: found
            .years
            .into_iter()
            .map(|y| YearView {
                year: y.year,
                running: y.running,
                figures: y.figures.into(),
                before: y.before.map(Into::into),
            })
            .collect(),
        best_day: found.best_day.map(Into::into),
        best_month: found.best_month.map(Into::into),
        best_saving: found.best_saving.map(Into::into),
    }))
}
