//! Rollups (ADR 0004): one metric's readings cut into UTC minute, hourly and daily buckets.
//! Counters roll up like gauges; their delta, chained across buckets with restart rules, is computed when
//! statistics are read (`fixtures/oracle/README.md` §3).
//!
//! A reading holds until the next one. A bucket's average is weighted by those holds, carries the previous
//! bucket's last reading in to its own first, and holds its own last reading out to its end, so a value
//! held across a boundary counts in both buckets in proportion. A bucket with no reading is absent.

use jiff::Timestamp;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tier {
    Minute,
    Hour,
    Day,
}

impl Tier {
    fn width_us(self) -> i64 {
        const MINUTE_US: i64 = 60_000_000;
        match self {
            Self::Minute => MINUTE_US,
            Self::Hour => 60 * MINUTE_US,
            Self::Day => 24 * 60 * MINUTE_US,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Bucket {
    pub start: Timestamp,
    /// Time-weighted mean.
    pub avg: f64,
    pub max: f64,
    pub min: f64,
}

/// One bucket's readings before its neighbours are known; times in microseconds.
#[derive(Debug, Clone, Copy)]
struct Partial {
    start: i64,
    first: (i64, f64),
    last: (i64, f64),
    /// Sum of each reading times how long it held, up to the bucket's last reading.
    weighted: f64,
    max: f64,
    min: f64,
}

impl Partial {
    fn new(start: i64, at: i64, value: f64) -> Self {
        Self { start, first: (at, value), last: (at, value), weighted: 0.0, max: value, min: value }
    }

    fn append(&mut self, other: &Self) {
        self.weighted = self.weighted + other.weighted + held(self.last, other.first.0);
        self.last = other.last;
        self.max = self.max.max(other.max);
        self.min = self.min.min(other.min);
    }
}

/// What `reading` contributes while it holds until `until`.
#[expect(clippy::cast_precision_loss, reason = "microsecond spans stay far below 2^53")]
fn held(reading: (i64, f64), until: i64) -> f64 {
    (until - reading.0) as f64 * reading.1
}

/// The buckets of `tier` that hold at least one of `readings`, oldest first. Readings may come in any order.
/// Holds about 80 bytes per reading while it runs; callers bound the input to keep ADR 0006's memory budget.
pub fn rollup(tier: Tier, readings: &[(Timestamp, f64)]) -> Vec<Bucket> {
    let mut sorted: Vec<(i64, f64)> = readings.iter().map(|(at, v)| (floor_us(*at), *v)).collect();
    sorted.sort_by_key(|p| p.0);
    let partials = match tier {
        Tier::Day => fold(Tier::Day, &fold(Tier::Hour, &raw(&sorted))),
        _ => fold(tier, &raw(&sorted)),
    };
    let width = tier.width_us();
    let mut previous: Option<&Partial> = None;
    let mut out = Vec::with_capacity(partials.len());
    for partial in &partials {
        out.push(close(partial, previous, width));
        previous = Some(partial);
    }
    out
}

/// `as_microsecond` truncates toward zero, which moves a pre-1970 instant forward.
fn floor_us(at: Timestamp) -> i64 {
    at.as_microsecond() - i64::from(at.subsec_nanosecond() % 1000 < 0)
}

fn raw(sorted: &[(i64, f64)]) -> Vec<Partial> {
    sorted.iter().map(|&(at, value)| Partial::new(at, at, value)).collect()
}

/// Partials merged into the `tier` buckets they start in.
fn fold(tier: Tier, parts: &[Partial]) -> Vec<Partial> {
    let width = tier.width_us();
    let mut out: Vec<Partial> = Vec::new();
    for part in parts {
        let start = part.start.div_euclid(width) * width;
        match out.last_mut() {
            Some(open) if open.start == start => open.append(part),
            _ => out.push(Partial { start, ..*part }),
        }
    }
    out
}

/// Extremes are the bucket's own readings; a value carried in counts only toward the average.
#[expect(clippy::cast_precision_loss, reason = "microsecond spans stay far below 2^53")]
fn close(partial: &Partial, previous: Option<&Partial>, width: i64) -> Bucket {
    let end = partial.start + width;
    let mut weighted = partial.weighted;
    let mut from = partial.first.0;
    if let Some(previous) = previous
        && partial.start < from
    {
        weighted += held((partial.start, previous.last.1), from);
        from = partial.start;
    }
    weighted += held(partial.last, end);
    Bucket {
        start: Timestamp::from_microsecond(partial.start).unwrap_or(Timestamp::MIN),
        avg: weighted / (end - from) as f64,
        max: partial.max,
        min: partial.min,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(instant: &str) -> Timestamp {
        instant.parse().unwrap()
    }

    fn bucket(start: &str, avg: f64, max: f64, min: f64) -> Bucket {
        Bucket { start: at(start), avg, max, min }
    }

    #[test]
    fn no_readings_make_no_buckets() {
        for tier in [Tier::Minute, Tier::Hour, Tier::Day] {
            assert_eq!(rollup(tier, &[]), []);
        }
    }

    #[test]
    fn a_first_reading_counts_from_itself_not_from_the_bucket_start() {
        let readings = [(at("2026-05-20T09:20:00Z"), 600.0)];
        assert_eq!(rollup(Tier::Hour, &readings), [bucket("2026-05-20T09:00:00Z", 600.0, 600.0, 600.0)]);
    }

    #[test]
    fn a_value_held_across_an_hour_is_shared_in_proportion() {
        // 100 from 23:50, 200 from 00:10: (100·10 + 200·50) / 60 for the 00:00 hour.
        let readings = [(at("2026-01-14T23:50:00Z"), 100.0), (at("2026-01-15T00:10:00Z"), 200.0)];
        assert_eq!(
            rollup(Tier::Hour, &readings),
            [
                bucket("2026-01-14T23:00:00Z", 100.0, 100.0, 100.0),
                bucket("2026-01-15T00:00:00Z", 1100.0 / 6.0, 200.0, 200.0),
            ]
        );
    }

    #[test]
    fn a_gap_carries_the_last_reading_into_the_next_bucket_that_holds_data() {
        // 250 held from 23:00 to 01:30, then 50: (250·30 + 50·30) / 60.
        let readings = [(at("2026-04-12T23:00:00Z"), 250.0), (at("2026-04-13T01:30:00Z"), 50.0)];
        assert_eq!(
            rollup(Tier::Hour, &readings),
            [
                bucket("2026-04-12T23:00:00Z", 250.0, 250.0, 250.0),
                bucket("2026-04-13T01:00:00Z", 150.0, 50.0, 50.0),
            ]
        );
    }

    #[test]
    fn zero_and_negative_readings_average_as_numbers() {
        // -300 for 15 min, 0 for 45 min.
        let readings = [(at("2026-02-10T12:00:00Z"), -300.0), (at("2026-02-10T12:15:00Z"), 0.0)];
        assert_eq!(rollup(Tier::Hour, &readings), [bucket("2026-02-10T12:00:00Z", -75.0, 0.0, -300.0)]);
    }

    #[test]
    fn a_counter_restart_keeps_both_the_old_high_and_the_new_low() {
        let readings = [(at("2026-05-10T12:00:00Z"), 5004.0), (at("2026-05-10T12:30:00Z"), 2.0)];
        assert_eq!(rollup(Tier::Hour, &readings), [bucket("2026-05-10T12:00:00Z", 2503.0, 5004.0, 2.0)]);
    }

    #[test]
    fn a_reading_on_a_boundary_opens_the_later_bucket() {
        let readings = [(at("2026-03-28T23:59:30Z"), 1.0), (at("2026-03-29T00:00:00Z"), 3.0)];
        assert_eq!(
            rollup(Tier::Minute, &readings),
            [bucket("2026-03-28T23:59:00Z", 1.0, 1.0, 1.0), bucket("2026-03-29T00:00:00Z", 3.0, 3.0, 3.0)]
        );
    }

    #[test]
    fn a_day_is_a_utc_day_even_when_the_plant_springs_forward() {
        // Europe/Berlin's 29 March 2026 runs 28 March 23:00Z to 29 March 22:00Z; the bucket stays at 00:00Z.
        let readings = [(at("2026-03-28T23:30:00Z"), 4.0), (at("2026-03-29T12:00:00Z"), 8.0)];
        assert_eq!(
            rollup(Tier::Day, &readings),
            [bucket("2026-03-28T00:00:00Z", 4.0, 4.0, 4.0), bucket("2026-03-29T00:00:00Z", 6.0, 8.0, 8.0)]
        );
    }

    #[test]
    fn readings_out_of_order_roll_up_as_if_sorted() {
        let sorted = [(at("2026-05-10T08:00:00Z"), 1.0), (at("2026-05-10T08:20:00Z"), 4.0)];
        let shuffled = [sorted[1], sorted[0]];
        assert_eq!(rollup(Tier::Hour, &shuffled), [bucket("2026-05-10T08:00:00Z", 3.0, 4.0, 1.0)]);
    }

    #[test]
    fn readings_before_1970_floor_to_their_own_bucket() {
        let readings = [(at("1969-12-31T23:59:30Z"), 7.0)];
        assert_eq!(rollup(Tier::Minute, &readings), [bucket("1969-12-31T23:59:00Z", 7.0, 7.0, 7.0)]);
    }

    #[test]
    fn a_reading_on_a_minute_before_1970_opens_that_minute() {
        let readings = [(at("1969-12-31T23:59:00Z"), 7.0)];
        assert_eq!(rollup(Tier::Minute, &readings), [bucket("1969-12-31T23:59:00Z", 7.0, 7.0, 7.0)]);
    }

    #[test]
    fn a_reading_half_a_microsecond_before_1970_stays_in_the_earlier_minute() {
        let readings = [(at("1969-12-31T23:59:59.9999995Z"), 7.0)];
        assert_eq!(rollup(Tier::Minute, &readings), [bucket("1969-12-31T23:59:00Z", 7.0, 7.0, 7.0)]);
    }
}
