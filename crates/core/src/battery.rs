//! The battery's usable capacity, inferred from its state of charge (ADR 4).
//!
//! No vendor register reports health. Each unbroken discharge of at least 20 points measures the energy it gave over
//! the charge it used, from the plant's hourly rollups, kept forever (ADR 3). Pure.

use std::time::{Duration, SystemTime};

use crate::storage::{Aggregate, Rollup};

/// A shallower discharge reads the 1 % steps of the state of charge too coarsely.
const DEPTH: f64 = 20.0;
/// An hour this far short of full has a gap.
const COVERED: Duration = Duration::from_mins(57);
/// Charging above this inside an hour splits a discharge; below it the battery idles.
const IDLE_W: f64 = 50.0;
/// How many measurements at each end the estimate and its reference take the median of.
const SPAN: usize = 5;
const YEAR_SECS: f64 = 365.25 * 86_400.0;

/// One unbroken discharge's capacity.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Measurement {
    /// When the discharge ended.
    pub end: SystemTime,
    pub kwh: f64,
}

/// The capacity estimate over the whole record.
#[derive(Debug, Clone, PartialEq)]
pub struct Estimate {
    pub measurements: Vec<Measurement>,
    /// The median of the latest five measurements, never the maximum: a noisy maximum fakes
    /// headroom.
    pub now: Option<f64>,
    /// The median of the first five: the reference without a nameplate.
    pub first: Option<f64>,
    /// The relative change per year, from half a year of measurements and more than five.
    pub per_year: Option<f64>,
    /// kWh the battery gave, summed per hour.
    pub discharged: f64,
    /// `discharged` over the nameplate capacity, or the estimate without one.
    pub cycles: Option<f64>,
    /// The first hour with battery power.
    pub since: Option<SystemTime>,
}

#[derive(Clone, Copy)]
struct Hour {
    start: SystemTime,
    end: SystemTime,
    soc: (f64, f64),
    wh: f64,
}

/// An hour of discharge without gaps: the state of charge's min and max, and the Wh it gave.
fn discharging(soc: &Rollup, power: &Rollup) -> Option<Hour> {
    let (
        Aggregate::Measurement {
            duration: held,
            min,
            max,
            ..
        },
        Aggregate::Measurement {
            duration,
            max: peak,
            integral,
            ..
        },
    ) = (soc.aggregate, power.aggregate)
    else {
        return None;
    };
    (held >= COVERED && duration >= COVERED && integral < 0.0 && peak <= IDLE_W).then_some(Hour {
        start: power.start,
        end: power.end,
        soc: (min, max),
        wh: -integral,
    })
}

/// Each unbroken discharge's capacity, from hourly rollups of `battery.soc` and `battery.power`
/// (positive charging, ADR 4) in time order.
#[must_use]
pub fn measurements(soc: &[Rollup], power: &[Rollup]) -> Vec<Measurement> {
    let mut found = Vec::new();
    let mut run: Vec<Hour> = Vec::new();
    let mut socs = soc.iter().peekable();
    for p in power {
        while socs.next_if(|s| s.start < p.start).is_some() {}
        let hour = socs
            .next_if(|s| s.start == p.start)
            .and_then(|s| discharging(s, p));
        match hour {
            Some(h) if run.last().is_none_or(|last| last.end == h.start) => run.push(h),
            other => {
                found.extend(measure(&run));
                run = other.into_iter().collect();
            }
        }
    }
    found.extend(measure(&run));
    found
}

/// A run of discharging hours: its state of charge falls from the first hour's maximum to the
/// last hour's minimum.
fn measure(run: &[Hour]) -> Option<Measurement> {
    let (first, last) = (run.first()?, run.last()?);
    let depth = first.soc.1 - last.soc.0;
    let kwh: f64 = run.iter().map(|h| h.wh).sum::<f64>() / 1000.0;
    (depth >= DEPTH).then(|| Measurement {
        end: last.end,
        kwh: kwh / (depth / 100.0),
    })
}

fn median(values: impl Iterator<Item = f64>) -> Option<f64> {
    let mut sorted: Vec<f64> = values.collect();
    sorted.sort_by(f64::total_cmp);
    let n = sorted.len();
    let high = *sorted.get(n / 2)?;
    if n % 2 == 1 {
        return Some(high);
    }
    sorted.get(n / 2 - 1).map(|low| f64::midpoint(*low, high))
}

/// The estimate over hourly rollups of the plant's `battery.soc` and `battery.power`, against
/// the nameplate capacity in kWh when a device reports one.
#[must_use]
pub fn estimate(soc: &[Rollup], power: &[Rollup], nameplate: Option<f64>) -> Estimate {
    let measurements = measurements(soc, power);
    let kwh = |m: &Measurement| m.kwh;
    let now = median(measurements.iter().rev().take(SPAN).map(kwh));
    let first = median(measurements.iter().take(SPAN).map(kwh));
    let per_year = match (measurements.first(), measurements.last(), now, first) {
        (Some(a), Some(b), Some(now), Some(first)) if measurements.len() > SPAN => {
            let years = b
                .end
                .duration_since(a.end)
                .map_or(0.0, |d| d.as_secs_f64() / YEAR_SECS);
            (years >= 0.5).then(|| (now - first) / first / years)
        }
        _ => None,
    };
    let discharged = power
        .iter()
        .filter_map(|p| match p.aggregate {
            Aggregate::Measurement { integral, .. } => Some((-integral).max(0.0)),
            Aggregate::Counter { .. } => None,
        })
        .sum::<f64>()
        / 1000.0;
    let reference = nameplate.filter(|n| *n > 0.0).or(now);
    Estimate {
        measurements,
        now,
        first,
        per_year,
        discharged,
        cycles: reference.map(|r| discharged / r),
        since: power.first().map(|p| p.start),
    }
}

#[cfg(test)]
mod tests;
