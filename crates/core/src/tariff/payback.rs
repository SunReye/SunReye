//! Payback (ADR 12): the savings rate summed against the investment the admin enters.

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use axum::http::StatusCode;
use rusqlite::{Connection, OptionalExtension, params};
use serde_json::json;

use super::device::DEVICE;
use super::{INTERNAL, Tariffs};
use crate::api::{Code, Problem};
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

impl Tariffs {
    /// The investment, if entered, and the EUR saved over every rolled-up hour.
    ///
    /// # Errors
    /// The file cannot be read.
    pub async fn payback(&self) -> Result<(Option<f64>, f64), Error> {
        let investment = self.database.run(investment).await?;
        let series = Series {
            role: "cost.savings.rate".to_owned(),
            index: None,
        };
        // Daily rollups are kept forever (ADR 3); the current day covers its closed hours.
        let days = self
            .reader
            .rollups(DEVICE, &series, Tier::Day, UNIX_EPOCH..UNIX_EPOCH + ALL)
            .await?;
        let savings = days
            .iter()
            .filter_map(|day| match day.aggregate {
                Aggregate::Measurement { integral, .. } => Some(integral),
                Aggregate::Counter { .. } => None,
            })
            .sum();
        Ok((investment, savings))
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
            .map_err(|_| INTERNAL)
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
