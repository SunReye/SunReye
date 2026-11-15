//! Payback (ADR 12): the savings rate summed against the investment the admin enters.

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use axum::http::StatusCode;
use jiff::ToSpan;
use jiff::civil::Date;
use rusqlite::{Connection, OptionalExtension, params};
use serde_json::json;

use super::Tariffs;
use super::device::DEVICE;
use crate::api::{Code, Problem, internal};
use crate::bus::Series;
use crate::changes::{self, Action, Entry, Subject};
use crate::storage::{Aggregate, Error, Tier};

const VALUE: Problem = Problem {
    status: StatusCode::UNPROCESSABLE_ENTITY,
    code: Code::InvestmentValue,
};
/// Every day rolled up, to 2106.
const ALL: Duration = Duration::from_secs(u32::MAX as u64);
/// Who enters the investment: the one admin (ADR 9).
const ACTOR: &str = "admin";
/// The pace needs this many days of record; until then one season would set it.
const PACED: i32 = 92;
const YEAR: i32 = 365;

/// The savings over time and when they reach the investment.
#[derive(Debug, Clone, PartialEq)]
pub struct Projection {
    /// The savings so far at each month's last recorded day.
    pub months: Vec<(Date, f64)>,
    /// EUR a year: the last twelve months' savings, or the record's scaled to a year.
    pub pace: Option<f64>,
    /// When the savings reach the investment at that pace; `None` once they have.
    pub reached: Option<Date>,
}

/// The projection over each plant-local day's savings, in date order, with `today` the
/// plant-local date now. Pure.
#[must_use]
pub fn project(days: &[(Date, f64)], today: Date, investment: Option<f64>) -> Projection {
    let mut months: Vec<(Date, f64)> = Vec::new();
    let mut run = 0.0;
    for &(date, saved) in days {
        run += saved;
        match months.last_mut() {
            Some(last) if last.0.first_of_month() == date.first_of_month() => *last = (date, run),
            _ => months.push((date, run)),
        }
    }
    let recorded = days
        .first()
        .and_then(|(first, _)| (today - *first).get_days().into());
    let pace = recorded.filter(|d: &i32| *d >= PACED).map(|d| {
        let from = today.checked_sub(YEAR.days()).unwrap_or(today);
        let year: f64 = days
            .iter()
            .filter(|(date, _)| *date >= from && *date < today)
            .map(|(_, saved)| saved)
            .sum();
        year * f64::from(YEAR) / f64::from(d.min(YEAR))
    });
    let reached = match (investment, pace) {
        (Some(i), Some(p)) if i > run && p > 0.0 => {
            let days = ((i - run) / p * f64::from(YEAR)).round();
            #[expect(
                clippy::cast_possible_truncation,
                reason = "a forecast within i32 days"
            )]
            today
                .checked_add((days.min(f64::from(i32::MAX)) as i32).days())
                .ok()
        }
        _ => None,
    };
    Projection {
        months,
        pace,
        reached,
    }
}

impl Tariffs {
    /// The investment, if entered, the EUR saved over every rolled-up hour, and their projection
    /// from the plant-local days to `now`.
    ///
    /// # Errors
    /// The file cannot be read.
    pub async fn payback(&self, now: SystemTime) -> Result<(Option<f64>, f64, Projection), Error> {
        let investment = self.database.run(investment).await?;
        let series = Series {
            role: "cost.savings.rate".to_owned(),
            index: None,
        };
        // Daily rollups are kept forever (ADR 3); the current day runs to the latest reading.
        let rollups = self
            .reader
            .rollups(DEVICE, &series, Tier::Day, UNIX_EPOCH..UNIX_EPOCH + ALL)
            .await?;
        let zone = self.zone.borrow().clone();
        let date = |time: SystemTime| {
            jiff::Timestamp::try_from(time)
                .ok()
                .map(|t| t.to_zoned(zone.clone()).date())
        };
        let days: Vec<(Date, f64)> = rollups
            .iter()
            .filter_map(|day| match day.aggregate {
                Aggregate::Measurement { integral, .. } => Some((date(day.start)?, integral)),
                Aggregate::Counter { .. } => None,
            })
            .collect();
        let savings = days.iter().map(|(_, saved)| saved).sum();
        let today = date(now).unwrap_or_default();
        Ok((investment, savings, project(&days, today, investment)))
    }

    /// Sets the investment to `amount` EUR at `changed`.
    ///
    /// # Errors
    /// An amount not above zero and finite, or the file cannot be written.
    pub async fn invest(&self, amount: f64, changed: SystemTime) -> Result<(), Problem> {
        if !(amount.is_finite() && amount > 0.0) {
            return Err(VALUE);
        }
        self.database
            .run(move |db| write(db, amount, changed))
            .await
            .map_err(internal)
    }
}

fn investment(db: &Connection) -> rusqlite::Result<Option<f64>> {
    db.query_row("SELECT amount FROM investment", [], |row| row.get(0))
        .optional()
}

fn write(db: &Connection, amount: f64, changed: SystemTime) -> rusqlite::Result<()> {
    let tx = db.unchecked_transaction()?;
    tx.execute(
        "INSERT INTO investment (id, amount) VALUES (0, ?1)
         ON CONFLICT (id) DO UPDATE SET amount = excluded.amount",
        params![amount],
    )?;
    let entry = Entry {
        subject: Subject::Investment,
        id: 0,
        action: Action::Change,
        state: Some(json!({ "amount": amount })),
        actor: ACTOR,
        changed,
        applies_from: changed,
    };
    changes::append(&tx, &entry)?;
    tx.commit()
}
