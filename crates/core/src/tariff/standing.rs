//! The standing charge (ADR 12): what each plant-local day owes of a tariff's monthly charge.

use std::ops::Range;
use std::time::SystemTime;

use jiff::civil::Date;
use jiff::tz::TimeZone;

use super::Version;

/// What a plant-local day owes.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Owed {
    pub start: SystemTime,
    pub end: SystemTime,
    pub euros: f64,
}

/// Each plant-local day starting within `range` that owes a standing charge by `now`.
///
/// Every instant of a plant-local month owes the same share of the charge in force, so a day owes
/// by its real length, and a month of any length the whole charge.
#[must_use]
pub fn owed(
    versions: &[Version],
    zone: &TimeZone,
    range: Range<SystemTime>,
    now: SystemTime,
) -> Vec<Owed> {
    let until = range.end.min(now);
    let mut days = Vec::new();
    let mut next = first(zone, range.start);
    while let Some(date) = next {
        let Some((start, end)) = span(zone, date, date).filter(|(start, _)| *start < until) else {
            break;
        };
        let month = span(zone, date.first_of_month(), date.last_of_month())
            .map_or(0.0, |(from, to)| seconds(from, to));
        let charged = charged(versions, start, end.min(now));
        if charged > 0.0 && month > 0.0 {
            days.push(Owed {
                start,
                end,
                euros: charged / month,
            });
        }
        next = date.tomorrow().ok();
    }
    days
}

/// The first plant-local date whose day starts at `from` or later.
fn first(zone: &TimeZone, from: SystemTime) -> Option<Date> {
    let date = jiff::Timestamp::try_from(from)
        .ok()?
        .to_zoned(zone.clone())
        .date();
    let (start, _) = span(zone, date, date)?;
    if start < from {
        date.tomorrow().ok()
    } else {
        Some(date)
    }
}

/// From the plant-local midnight `first` starts with to the one `last` ends with.
fn span(zone: &TimeZone, first: Date, last: Date) -> Option<(SystemTime, SystemTime)> {
    let midnight = |date: Date| Some(date.to_zoned(zone.clone()).ok()?.timestamp().into());
    Some((midnight(first)?, midnight(last.tomorrow().ok()?)?))
}

/// Each version's charge times the seconds it is in force from `from` to `to`.
fn charged(versions: &[Version], from: SystemTime, to: SystemTime) -> f64 {
    let ends = versions.iter().skip(1).map(|next| next.applies_from);
    versions
        .iter()
        .zip(ends.chain([to]))
        .map(|(version, end)| {
            version.standing_charge * seconds(version.applies_from.max(from), end.min(to))
        })
        .sum()
}

/// The seconds from `from` to `to`, none when it is not later.
fn seconds(from: SystemTime, to: SystemTime) -> f64 {
    to.duration_since(from)
        .map_or(0.0, |span| span.as_secs_f64())
}

#[cfg(test)]
mod tests;
