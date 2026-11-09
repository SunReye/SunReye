//! The tariff computed device (ADR 12, 15): the admin's import and feed-in prices, fixed or in
//! time-of-use bands, evaluated in the plant timezone and published as `price.import` and
//! `price.export`.
//!
//! The tariff module owns the `tariff` and `tariff_band` tables. A change is a new version applying
//! from its instant, never before the change itself: editing changes only the future.

mod routes;
mod store;

use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use axum::http::StatusCode;
use jiff::tz::TimeZone;
use tokio::sync::watch;

use crate::api::{Code, Problem};
use crate::changes;
use crate::storage::{Database, Error};

const INTERNAL: Problem = Problem {
    status: StatusCode::INTERNAL_SERVER_ERROR,
    code: Code::Internal,
};
const PAST: Problem = Problem {
    status: StatusCode::UNPROCESSABLE_ENTITY,
    code: Code::TariffPast,
};
const BAND: Problem = Problem {
    status: StatusCode::UNPROCESSABLE_ENTITY,
    code: Code::TariffBand,
};
/// Minutes in a wall-clock day; a band may end at 24:00.
const DAY: u16 = 24 * 60;

/// Prices in EUR/kWh.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Prices {
    pub import: f64,
    pub export: f64,
}

/// ISO weekdays, Monday 1 to Sunday 7, as a bit each.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Days(u8);

impl Days {
    /// `None` for an empty set or a day outside 1 to 7.
    #[must_use]
    pub fn of(days: &[u8]) -> Option<Self> {
        let mut bits = 0_u8;
        for &day in days {
            if !(1..=7).contains(&day) {
                return None;
            }
            bits |= 1 << (day - 1);
        }
        (bits != 0).then_some(Self(bits))
    }

    /// The ISO weekdays, in order.
    #[must_use]
    pub fn days(self) -> Vec<u8> {
        (1..=7).filter(|&day| self.contains(day)).collect()
    }

    const fn contains(self, day: u8) -> bool {
        self.0 & (1 << (day - 1)) != 0
    }
}

/// A price on given plant-local weekdays, from one wall-clock minute of the day up to another.
/// A band in the hour a DST change skips never applies; in the hour it repeats it applies twice.
#[derive(Debug, Clone, PartialEq)]
pub struct Band {
    pub days: Days,
    pub from: u16,
    pub to: u16,
    pub price: f64,
}

/// One flow's price: a band's where one applies, else the base price.
#[derive(Debug, Clone, PartialEq)]
pub struct Schedule {
    pub price: f64,
    pub bands: Vec<Band>,
}

/// One tariff version.
#[derive(Debug, Clone, PartialEq)]
pub struct Version {
    pub applies_from: SystemTime,
    pub import: Schedule,
    pub export: Schedule,
}

impl Version {
    /// The prices at `at`, on the wall clock of the plant timezone `zone`.
    #[must_use]
    pub fn prices(&self, zone: &TimeZone, at: SystemTime) -> Prices {
        let local = jiff::Timestamp::try_from(at)
            .unwrap_or(jiff::Timestamp::UNIX_EPOCH)
            .to_zoned(zone.clone());
        let day = u8::try_from(local.weekday().to_monday_one_offset()).unwrap_or(1);
        let minute = u16::try_from(local.hour()).unwrap_or(0) * 60
            + u16::try_from(local.minute()).unwrap_or(0);
        Prices {
            import: self.import.price(day, minute),
            export: self.export.price(day, minute),
        }
    }
}

impl Schedule {
    fn price(&self, day: u8, minute: u16) -> f64 {
        self.bands
            .iter()
            .find(|b| b.days.contains(day) && b.from <= minute && minute < b.to)
            .map_or(self.price, |b| b.price)
    }
}

/// The version in force at `at`: the latest applying by then, ties to the later; `versions` by the
/// instant they apply from.
#[must_use]
pub fn in_force(versions: &[Version], at: SystemTime) -> Option<&Version> {
    versions.iter().rev().find(|v| v.applies_from <= at)
}

/// When the device next publishes after `at`: the next whole minute, or a version applying sooner.
///
/// Bands start on whole wall-clock minutes, and every zone in use is offset from UTC by whole
/// minutes, so a whole UTC minute catches every band edge.
#[must_use]
pub fn wake(versions: &[Version], at: SystemTime) -> SystemTime {
    let since = at.duration_since(UNIX_EPOCH).unwrap_or_default().as_secs();
    let minute = UNIX_EPOCH + Duration::from_secs((since / 60 + 1) * 60);
    versions
        .iter()
        .map(|v| v.applies_from)
        .filter(|&from| from > at)
        .fold(minute, SystemTime::min)
}

impl Schedule {
    /// Each band within one day, and no two sharing a minute of a weekday.
    fn valid(&self) -> bool {
        let spans = self.bands.iter().all(|b| b.from < b.to && b.to <= DAY);
        let apart = self.bands.iter().enumerate().all(|(i, a)| {
            self.bands
                .iter()
                .skip(i + 1)
                .all(|b| a.days.0 & b.days.0 == 0 || a.to <= b.from || b.to <= a.from)
        });
        spans && apart
    }
}

/// The tariff feature module; clones share one.
#[derive(Debug, Clone)]
pub struct Tariffs {
    database: Database,
    changed: Arc<watch::Sender<()>>,
}

impl Tariffs {
    #[must_use]
    pub fn new(database: Database) -> Self {
        Self {
            database,
            changed: Arc::new(watch::channel(()).0),
        }
    }

    /// Marked changed by each tariff change.
    #[must_use]
    pub fn changes(&self) -> watch::Receiver<()> {
        self.changed.subscribe()
    }

    /// Every version, by the instant it applies from, a later change after an earlier one.
    ///
    /// # Errors
    /// The file cannot be read.
    pub async fn versions(&self) -> Result<Vec<Version>, Error> {
        self.database.run(store::versions).await
    }

    /// Appends `version`, logged as changed at `changed`.
    ///
    /// # Errors
    /// It applies from before `changed`, a band is not one span of a day or overlaps another of its
    /// flow, or the file cannot be written.
    pub async fn change(&self, version: Version, changed: SystemTime) -> Result<Version, Problem> {
        // Whole seconds, as stored: a version applying from now is not in the past.
        if changes::seconds(version.applies_from) < changes::seconds(changed) {
            return Err(PAST);
        }
        if !(version.import.valid() && version.export.valid()) {
            return Err(BAND);
        }
        let stored = self
            .database
            .run(move |db| store::insert(db, version, changed))
            .await
            .map_err(|_| INTERNAL)?;
        self.changed.send_replace(());
        Ok(stored)
    }
}

#[cfg(test)]
mod tests;
