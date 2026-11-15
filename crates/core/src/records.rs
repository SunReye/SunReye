//! Every recorded year and the plant's records (ADR 11), from the plant's and the tariff's daily
//! rollups, kept forever (ADR 3). Pure: the route reads the days.

use std::collections::BTreeMap;

use jiff::civil::Date;

/// A span's energies in kWh and its savings in EUR. Autarky is `self_supply / consumption`,
/// never a summed percentage (ADR 4).
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct Figures {
    pub production: f64,
    pub consumption: f64,
    pub self_supply: f64,
    /// `None` without a cost day: no tariff priced it.
    pub saved: Option<f64>,
}

impl Figures {
    fn add(&mut self, other: &Self) {
        self.production += other.production;
        self.consumption += other.consumption;
        self.self_supply += other.self_supply;
        if let Some(s) = other.saved {
            self.saved = Some(self.saved.unwrap_or(0.0) + s);
        }
    }
}

/// One plant-local day's figures.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Day {
    pub date: Date,
    pub figures: Figures,
}

/// One plant-local year.
#[derive(Debug, Clone, PartialEq)]
pub struct Year {
    pub year: i16,
    /// The year today is in, summed to today.
    pub running: bool,
    pub figures: Figures,
    /// The year before over the same dates; `None` before the record began.
    pub before: Option<Figures>,
}

/// A best day or month: its first date and its value.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Best {
    pub date: Date,
    pub value: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Records {
    /// Newest first.
    pub years: Vec<Year>,
    /// The most kWh produced on a closed day.
    pub best_day: Option<Best>,
    /// The most kWh produced in a closed month.
    pub best_month: Option<Best>,
    /// The most EUR saved on a closed day.
    pub best_saving: Option<Best>,
}

fn best(candidates: impl Iterator<Item = (Date, f64)>) -> Option<Best> {
    candidates
        .filter(|(_, v)| *v > 0.0)
        .fold(None, |top: Option<Best>, (date, value)| match top {
            Some(t) if t.value >= value => Some(t),
            _ => Some(Best { date, value }),
        })
}

/// The years and records of `days`, in date order, with `today` the plant-local date now.
#[must_use]
pub fn records(days: &[Day], today: Date) -> Records {
    let mut years: BTreeMap<i16, Figures> = BTreeMap::new();
    let mut months: BTreeMap<Date, f64> = BTreeMap::new();
    for d in days {
        years.entry(d.date.year()).or_default().add(&d.figures);
        *months.entry(d.date.first_of_month()).or_default() += d.figures.production;
    }
    let same_dates = |year: i16| {
        let mut sum: Option<Figures> = None;
        let cut = |d: &Day| (d.date.month(), d.date.day()) <= (today.month(), today.day());
        for d in days.iter().filter(|d| d.date.year() == year && cut(d)) {
            sum.get_or_insert_default().add(&d.figures);
        }
        sum
    };
    let rows = years
        .iter()
        .rev()
        .map(|(&year, &figures)| {
            let running = year == today.year();
            let before = if running {
                same_dates(year - 1)
            } else {
                years.get(&(year - 1)).copied()
            };
            Year {
                year,
                running,
                figures,
                before,
            }
        })
        .collect();
    let closed = days.iter().filter(|d| d.date < today);
    Records {
        years: rows,
        best_day: best(closed.clone().map(|d| (d.date, d.figures.production))),
        best_month: best(
            months
                .into_iter()
                .filter(|(month, _)| *month < today.first_of_month()),
        ),
        best_saving: best(closed.filter_map(|d| Some((d.date, d.figures.saved?)))),
    }
}

#[cfg(test)]
mod tests;
