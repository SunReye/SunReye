//! What the plant paid, earned and saved per plant-local day (ADR 12), from the daily rollups of
//! the `cost.*` rates, and the standing charge each day owes.

use std::collections::BTreeMap;
use std::ops::Range;
use std::time::SystemTime;

use super::Tariffs;
use super::device::{COSTS, DEVICE};
use super::standing::owed;
use crate::bus::Series;
use crate::storage::{Aggregate, Error, Tier};

/// EUR paid, earned and saved, and the standing charge owed.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct Costs {
    pub paid: f64,
    pub earned: f64,
    pub saved: f64,
    pub standing: f64,
}

impl std::ops::Add for Costs {
    type Output = Self;

    fn add(self, other: Self) -> Self {
        Self {
            paid: self.paid + other.paid,
            earned: self.earned + other.earned,
            saved: self.saved + other.saved,
            standing: self.standing + other.standing,
        }
    }
}

impl Costs {
    fn credit(&mut self, rate: usize, euros: f64) {
        match rate {
            0 => self.paid += euros,
            1 => self.earned += euros,
            _ => self.saved += euros,
        }
    }

    /// Rounded to the cent.
    #[must_use]
    pub fn cents(self) -> Self {
        let cents = |euros: f64| (euros * 100.0).round() / 100.0;
        Self {
            paid: cents(self.paid),
            earned: cents(self.earned),
            saved: cents(self.saved),
            standing: cents(self.standing),
        }
    }
}

impl Tariffs {
    /// Each plant-local day within `range` that is rolled up or owes a standing charge by `now`,
    /// by start, with its end and its costs.
    ///
    /// # Errors
    /// The file cannot be read.
    pub async fn days(
        &self,
        range: Range<SystemTime>,
        now: SystemTime,
    ) -> Result<BTreeMap<SystemTime, (SystemTime, Costs)>, Error> {
        let mut days: BTreeMap<SystemTime, (SystemTime, Costs)> = BTreeMap::new();
        for (rate, role) in COSTS.iter().enumerate() {
            let series = Series {
                role: (*role).to_owned(),
                index: None,
            };
            let rollups = self
                .reader
                .rollups(DEVICE, &series, Tier::Day, range.clone())
                .await?;
            let integrals = rollups.into_iter().filter_map(|r| match r.aggregate {
                Aggregate::Measurement { integral, .. } => Some((r.start, r.end, integral)),
                Aggregate::Counter { .. } | Aggregate::Held { .. } => None,
            });
            for (start, end, integral) in integrals {
                let (_, costs) = days.entry(start).or_insert_with(|| (end, Costs::default()));
                costs.credit(rate, integral);
            }
        }
        let versions = self.versions().await?;
        let zone = self.zone.borrow().clone();
        for day in owed(&versions, &zone, range, now) {
            let (_, costs) = days
                .entry(day.start)
                .or_insert_with(|| (day.end, Costs::default()));
            costs.standing += day.euros;
        }
        Ok(days)
    }
}
