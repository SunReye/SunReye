//! Energy statistics (ADR 0004), ported from 3.x (`apps/server/src/energy/`) and held against
//! `fixtures/oracle/statistics.ndjson`.
//!
//! Energy is the rise of a lifetime counter between rollup buckets, computed when statistics are read:
//! a bucket's rise is its high less the previous bucket's high, never below zero. A bucket with no
//! predecessor, one past [`View::max_gap_us`] back, or (for a register that resets every day) one on
//! the far side of the plant's midnight falls back to its own low, or to the stale level when the
//! counter restarted inside it, so a restart or one spurious low read costs one bucket, never the
//! lifetime total.
//!
//! Buckets are UTC; the plant zone only cuts periods. Hours and days read the hourly tier, so a day is
//! exact only for a whole-hour zone offset. Months and years read the daily tier as 2.x does: a UTC day
//! belongs to the month its start falls in.

use std::collections::BTreeMap;

use jiff::tz::TimeZone;
use jiff::{RoundMode, Span, Timestamp, Unit, Zoned, ZonedRound};
use serde::Serialize;
use utoipa::ToSchema;

use crate::profile::Profile;
use crate::rollup::Bucket;

/// Role to the metric key that carries it.
pub type Roles = BTreeMap<String, String>;

/// A profile's roles; a role two metrics share names the first.
pub fn roles_of(profile: &Profile) -> Roles {
    let mut roles = Roles::new();
    for metric in &profile.metrics {
        if let Some(role) = &metric.role {
            roles.entry(role.clone()).or_insert_with(|| metric.key.clone());
        }
    }
    roles
}

/// Whether the plant meters house consumption as energy. Without a load counter the load is implied
/// from the flows around it.
pub fn meters_load(roles: &Roles) -> bool {
    roles.contains_key("load.energy.total") || roles.contains_key("load.energy.today")
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Field {
    Import,
    Export,
    Load,
    Production,
    BatteryDischarge,
    BatteryCharge,
}

impl Field {
    const ALL: [Self; 6] = [
        Self::Import,
        Self::Export,
        Self::Load,
        Self::Production,
        Self::BatteryDischarge,
        Self::BatteryCharge,
    ];

    const fn total_role(self) -> &'static str {
        match self {
            Self::Import => "grid.energy.imported.total",
            Self::Export => "grid.energy.exported.total",
            Self::Load => "load.energy.total",
            Self::Production => "production.total",
            Self::BatteryDischarge => "battery.energy.discharged.total",
            Self::BatteryCharge => "battery.energy.charged.total",
        }
    }

    /// The register that resets every day, twin of [`Field::total_role`].
    const fn today_role(self) -> &'static str {
        match self {
            Self::Import => "grid.energy.imported.today",
            Self::Export => "grid.energy.exported.today",
            Self::Load => "load.energy.today",
            Self::Production => "production.today",
            Self::BatteryDischarge => "battery.energy.discharged.today",
            Self::BatteryCharge => "battery.energy.charged.today",
        }
    }
}

/// The tier a read walks.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum View {
    Hour,
    Day,
}

impl View {
    const HOUR_US: i64 = 3_600_000_000;

    /// The longest hole in the record a rise may bridge: past it the rise belongs to no bucket, and the
    /// bucket books only what it saw itself.
    const fn max_gap_us(self) -> i64 {
        match self {
            Self::Hour => 3 * Self::HOUR_US,
            Self::Day => 48 * Self::HOUR_US,
        }
    }

    /// Microseconds one bucket spans.
    pub const fn width_us(self) -> i64 {
        match self {
            Self::Hour => Self::HOUR_US,
            Self::Day => 24 * Self::HOUR_US,
        }
    }
}

/// The metric a field's rises are read from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Source {
    pub field: Field,
    pub key: String,
    pub resets_daily: bool,
}

/// One source per field the roles carry. The hourly view differences the daily register where the profile
/// has one: a lifetime counter has no bound on its first reading, a day's register has one day.
pub fn sources(roles: &Roles, view: View) -> Vec<Source> {
    Field::ALL
        .into_iter()
        .filter_map(|field| {
            let today = roles.get(field.today_role()).filter(|_| view == View::Hour);
            match (today, roles.get(field.total_role())) {
                (Some(key), _) => Some(Source { field, key: key.clone(), resets_daily: true }),
                (None, Some(key)) => Some(Source { field, key: key.clone(), resets_daily: false }),
                (None, None) => None,
            }
        })
        .collect()
}

fn local_day(zone: &TimeZone, at: Timestamp) -> jiff::civil::Date {
    zone.to_datetime(at).date()
}

/// Whether `bucket` may book the rise since `before`.
fn chains(before: &Bucket, bucket: &Bucket, source: &Source, view: View, zone: &TimeZone) -> bool {
    let gap = bucket.start.as_microsecond() - before.start.as_microsecond();
    gap <= view.max_gap_us()
        && !(source.resets_daily && local_day(zone, before.start) != local_day(zone, bucket.start))
}

/// What a bucket books when it cannot chain: its low, unless the previous high lies inside it, which is a
/// restart in the bucket and makes only the rise above that level observed.
fn own_base(bucket: &Bucket, stale: Option<f64>) -> f64 {
    match stale {
        Some(stale) if stale > bucket.min && stale <= bucket.max => stale,
        _ => bucket.min,
    }
}

/// The rise of each of `buckets` (oldest first, one metric), chained from `before`, the last bucket ahead
/// of them.
pub fn rises(
    source: &Source,
    view: View,
    zone: &TimeZone,
    before: Option<&Bucket>,
    buckets: &[Bucket],
) -> Rises {
    let mut previous = before.copied();
    buckets
        .iter()
        .map(|bucket| {
            let base = match &previous {
                Some(prev) if chains(prev, bucket, source, view, zone) => prev.max,
                prev => own_base(bucket, prev.as_ref().map(|p| p.max)),
            };
            previous = Some(*bucket);
            (bucket.start, (bucket.max - base).max(0.0))
        })
        .collect()
}

/// Each bucket's start and what its counter rose by, in kWh.
pub type Rises = Vec<(Timestamp, f64)>;

/// Energy in kWh, by field.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct Totals {
    pub import: f64,
    pub export: f64,
    pub load: f64,
    pub production: f64,
    pub battery_discharge: f64,
    pub battery_charge: f64,
}

impl Totals {
    fn add(&mut self, field: Field, kwh: f64) {
        match field {
            Field::Import => self.import += kwh,
            Field::Export => self.export += kwh,
            Field::Load => self.load += kwh,
            Field::Production => self.production += kwh,
            Field::BatteryDischarge => self.battery_discharge += kwh,
            Field::BatteryCharge => self.battery_charge += kwh,
        }
    }

    fn plus(&mut self, other: &Self) {
        for field in Field::ALL {
            self.add(field, other.get(field));
        }
    }

    const fn get(&self, field: Field) -> f64 {
        match field {
            Field::Import => self.import,
            Field::Export => self.export,
            Field::Load => self.load,
            Field::Production => self.production,
            Field::BatteryDischarge => self.battery_discharge,
            Field::BatteryCharge => self.battery_charge,
        }
    }

    /// The load the flows imply: everything that entered the house less everything that left it, never
    /// below zero (a restart can leave a bucket exporting more than it made).
    #[must_use]
    pub fn with_implied_load(self) -> Self {
        let entered = self.production + self.import + self.battery_discharge;
        Self { load: (entered - self.export - self.battery_charge).max(0.0), ..self }
    }
}

/// Every field's rises merged by bucket start.
pub fn totals_by_bucket(rises: Vec<(Field, Rises)>) -> BTreeMap<Timestamp, Totals> {
    let mut out: BTreeMap<Timestamp, Totals> = BTreeMap::new();
    for (field, series) in rises {
        for (start, kwh) in series {
            out.entry(start).or_default().add(field, kwh);
        }
    }
    out
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Period {
    Hour,
    Day,
    Month,
    Year,
}

/// The periods a read cuts: `period`s of `zone` in `[from, to)`.
#[derive(Debug, Clone, Copy)]
pub struct Cut<'a> {
    pub period: Period,
    pub zone: &'a TimeZone,
    pub from: Timestamp,
    pub to: Timestamp,
}

impl Cut<'_> {
    /// A year is its months, summed.
    const fn grain(&self) -> Period {
        match self.period {
            Period::Year => Period::Month,
            other => other,
        }
    }

    fn key(&self, grain: Period, at: Timestamp) -> String {
        let local = self.zone.to_datetime(at);
        let mask = match grain {
            Period::Hour => "%Y-%m-%dT%H",
            Period::Day => "%Y-%m-%d",
            Period::Month | Period::Year => "%Y-%m",
        };
        local.strftime(mask).to_string()
    }

    /// The local start of the `grain` period holding `at`.
    fn start_of(&self, grain: Period, at: Timestamp) -> Option<Zoned> {
        let zoned = at.to_zoned(self.zone.clone());
        match grain {
            Period::Hour => zoned.round(ZonedRound::new().smallest(Unit::Hour).mode(RoundMode::Trunc)).ok(),
            Period::Day => zoned.start_of_day().ok(),
            Period::Month | Period::Year => zoned.date().first_of_month().to_zoned(self.zone.clone()).ok(),
        }
    }

    /// The local start of the period after the one starting at `start`.
    fn after(&self, grain: Period, start: &Zoned) -> Option<Zoned> {
        let step = match grain {
            Period::Hour => Span::new().hours(1),
            Period::Day => Span::new().days(1),
            Period::Month | Period::Year => Span::new().months(1),
        };
        if grain == Period::Hour {
            return start.checked_add(step).ok();
        }
        start.date().checked_add(step).ok()?.to_zoned(self.zone.clone()).ok()
    }

    /// The keys of the `grain` periods in the window, oldest first. A period the window clips by more than
    /// half is left out, or the whole window when that is shorter, so a window cut in another zone does
    /// not open with a bar of two hours. A repeated hour of a clock change is one period. An empty or reversed window has none.
    fn keys(&self, grain: Period) -> Vec<String> {
        let mut keys: Vec<String> = Vec::new();
        if self.to <= self.from {
            return keys;
        }
        let mut current = self.start_of(grain, self.from);
        while let Some(start) = current.filter(|start| start.timestamp() < self.to) {
            let Some(next) = self.after(grain, &start) else { break };
            let key = self.key(grain, start.timestamp());
            if self.keeps(&start, &next) && keys.last() != Some(&key) {
                keys.push(key);
            }
            current = Some(next);
        }
        keys
    }

    /// Whether the window covers at least half of the period `[start, next)`, or all of a window shorter.
    fn keeps(&self, start: &Zoned, next: &Zoned) -> bool {
        let (from, to) = (self.from.as_microsecond(), self.to.as_microsecond());
        let (a, b) = (start.timestamp().as_microsecond(), next.timestamp().as_microsecond());
        b.min(to) - a.max(from) >= ((b - a) / 2).min(to - from)
    }
}

/// One period's energy and the splits derived from it.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PeriodEnergy {
    /// Plant-local key: `YYYY-MM-DDTHH`, `YYYY-MM-DD`, `YYYY-MM` or `YYYY`.
    pub bucket: String,
    pub import_kwh: f64,
    pub export_kwh: f64,
    pub load_kwh: f64,
    pub production_kwh: f64,
    pub battery_discharge_kwh: f64,
    pub battery_charge_kwh: f64,
    pub grid_to_load_kwh: f64,
    pub solar_to_load_kwh: f64,
    pub battery_to_load_kwh: f64,
    pub solar_direct_to_load_kwh: f64,
    /// Production used on site: production less export, never below zero.
    pub self_consumed_kwh: f64,
    pub exported_kwh: f64,
    /// Solar to load over load, 0..1; null without load.
    #[schema(required = true)]
    pub self_sufficiency: Option<f64>,
    /// Self-consumed over production, 0..1; null without production.
    #[schema(required = true)]
    pub self_consumption: Option<f64>,
}

impl PeriodEnergy {
    fn derive(bucket: String, totals: Totals, implied_load: bool) -> Self {
        let t = if implied_load { totals.with_implied_load() } else { totals };
        let solar_to_load = (t.load - t.import).max(0.0);
        let battery_to_load = t.battery_discharge.max(0.0).min(solar_to_load);
        let self_consumed = (t.production - t.export).max(0.0);
        let ratio = |part: f64, whole: f64| (whole > 0.0).then(|| (part / whole).clamp(0.0, 1.0));
        Self {
            bucket,
            import_kwh: t.import,
            export_kwh: t.export,
            load_kwh: t.load,
            production_kwh: t.production,
            battery_discharge_kwh: t.battery_discharge,
            battery_charge_kwh: t.battery_charge,
            grid_to_load_kwh: t.import.min(t.load),
            solar_to_load_kwh: solar_to_load,
            battery_to_load_kwh: battery_to_load,
            solar_direct_to_load_kwh: (solar_to_load - battery_to_load).max(0.0),
            self_consumed_kwh: self_consumed,
            exported_kwh: t.export,
            self_sufficiency: ratio(solar_to_load, t.load),
            self_consumption: ratio(self_consumed, t.production),
        }
    }
}

/// One entry per period of `cut`, oldest first, zero-filled so the axis is stable; `buckets` holds the
/// rises to sum into them. Rises outside every period count for nothing.
pub fn energy_series(
    cut: &Cut<'_>,
    buckets: &BTreeMap<Timestamp, Totals>,
    implied_load: bool,
) -> Vec<PeriodEnergy> {
    let grain = cut.grain();
    let keys = cut.keys(grain);
    let mut sums: BTreeMap<String, Totals> =
        keys.iter().map(|key| (key.clone(), Totals::default())).collect();
    for (start, totals) in buckets {
        if let Some(sum) = sums.get_mut(&cut.key(grain, *start)) {
            sum.plus(totals);
        }
    }
    let (keys, sums) = if cut.period == Period::Year { fold_years(keys, &sums) } else { (keys, sums) };
    keys.into_iter()
        .map(|key| {
            let totals = sums.get(&key).copied().unwrap_or_default();
            PeriodEnergy::derive(key, totals, implied_load)
        })
        .collect()
}

/// The years the month `keys` fall in, and each year's months summed.
fn fold_years(
    keys: Vec<String>,
    months: &BTreeMap<String, Totals>,
) -> (Vec<String>, BTreeMap<String, Totals>) {
    let mut years: Vec<String> = Vec::new();
    let mut sums: BTreeMap<String, Totals> = BTreeMap::new();
    for key in keys {
        let year = key.chars().take(4).collect::<String>();
        if let Some(month) = months.get(&key) {
            sums.entry(year.clone()).or_default().plus(month);
        }
        if years.last() != Some(&year) {
            years.push(year);
        }
    }
    (years, sums)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(instant: &str) -> Timestamp {
        instant.parse().expect("instant")
    }

    fn bucket(start: &str, max: f64, min: f64) -> Bucket {
        Bucket { start: at(start), avg: max, max, min }
    }

    fn total(key: &str) -> Source {
        Source { field: Field::Production, key: key.into(), resets_daily: false }
    }

    fn rise(source: &Source, view: View, before: &Bucket, next: &Bucket) -> f64 {
        rises(source, view, &TimeZone::UTC, Some(before), &[*next])[0].1
    }

    #[test]
    fn a_bucket_three_hours_on_chains_and_four_hours_on_books_only_its_own_rise() {
        let before = bucket("2026-05-01T00:00:00Z", 10.0, 10.0);
        let three = bucket("2026-05-01T03:00:00Z", 13.0, 12.0);
        let four = bucket("2026-05-01T04:00:00Z", 14.0, 12.0);
        assert_eq!(rise(&total("p"), View::Hour, &before, &three), 3.0);
        assert_eq!(rise(&total("p"), View::Hour, &before, &four), 2.0);
    }

    #[test]
    fn a_bucket_two_days_on_chains_and_three_days_on_books_only_its_own_rise() {
        let before = bucket("2026-05-01T00:00:00Z", 100.0, 100.0);
        let two = bucket("2026-05-03T00:00:00Z", 110.0, 105.0);
        let three = bucket("2026-05-04T00:00:00Z", 110.0, 105.0);
        assert_eq!(rise(&total("p"), View::Day, &before, &two), 10.0);
        assert_eq!(rise(&total("p"), View::Day, &before, &three), 5.0);
    }

    #[test]
    fn a_counter_that_restarts_inside_a_bucket_books_only_the_rise_above_its_old_level() {
        let before = bucket("2026-05-01T00:00:00Z", 5004.0, 5004.0);
        // 5004 is inside (2, 5004]: the counter fell to 2 and rose again to 5004 or past it.
        let past = bucket("2026-05-01T05:00:00Z", 5006.0, 2.0);
        let exact = bucket("2026-05-01T05:00:00Z", 5004.0, 2.0);
        let below = bucket("2026-05-01T05:00:00Z", 5003.0, 2.0);
        assert_eq!(rise(&total("p"), View::Hour, &before, &past), 2.0);
        assert_eq!(rise(&total("p"), View::Hour, &before, &exact), 0.0);
        // A high short of the old level is no restart in the bucket: it books its own span.
        assert_eq!(rise(&total("p"), View::Hour, &before, &below), 5001.0);
    }

    #[test]
    fn a_falling_counter_books_nothing() {
        let before = bucket("2026-05-01T00:00:00Z", 10.0, 10.0);
        let lower = bucket("2026-05-01T01:00:00Z", 4.0, 4.0);
        assert_eq!(rise(&total("p"), View::Hour, &before, &lower), 0.0);
    }

    #[test]
    fn a_bucket_with_nothing_before_it_books_its_own_rise() {
        let first = bucket("2026-05-01T00:00:00Z", 9.0, 7.5);
        assert_eq!(rises(&total("p"), View::Hour, &TimeZone::UTC, None, &[first])[0].1, 1.5);
    }

    #[test]
    fn a_day_register_does_not_chain_across_the_plants_midnight() {
        let berlin = TimeZone::get("Europe/Berlin").expect("zone");
        let before = bucket("2026-04-09T21:00:00Z", 5.0, 5.0);
        let after = bucket("2026-04-09T22:00:00Z", 0.3, 0.0);
        let same_day = bucket("2026-04-09T20:00:00Z", 0.3, 0.0);
        let mut day = total("today");
        day.resets_daily = true;
        let across = rises(&day, View::Hour, &berlin, Some(&before), &[after])[0].1;
        assert_eq!(across, 0.3);
        // The lifetime counter chains through midnight: its fall books nothing.
        let lifetime = rises(&total("p"), View::Hour, &berlin, Some(&before), &[after])[0].1;
        assert_eq!(lifetime, 0.0);
        // One hour earlier, the same local day: the day register chains too.
        let chained = rises(&day, View::Hour, &berlin, Some(&same_day), &[before])[0].1;
        assert_eq!(chained, 5.0 - 0.3);
    }

    fn roles(pairs: &[(&str, &str)]) -> Roles {
        pairs.iter().map(|(role, key)| ((*role).to_owned(), (*key).to_owned())).collect()
    }

    #[test]
    fn the_hourly_view_reads_the_day_register_where_there_is_one_and_the_daily_view_the_lifetime_one() {
        let roles = roles(&[
            ("production.total", "life"),
            ("production.today", "day"),
            ("grid.energy.imported.total", "in"),
        ]);
        let pick = |view| {
            sources(&roles, view).into_iter().map(|s| (s.field, s.key, s.resets_daily)).collect::<Vec<_>>()
        };
        assert_eq!(
            pick(View::Hour),
            [(Field::Import, "in".into(), false), (Field::Production, "day".into(), true)]
        );
        assert_eq!(
            pick(View::Day),
            [(Field::Import, "in".into(), false), (Field::Production, "life".into(), false)]
        );
    }

    #[test]
    fn a_plant_meters_its_load_when_either_load_counter_is_mapped() {
        assert!(!meters_load(&roles(&[("production.total", "p")])));
        assert!(meters_load(&roles(&[("load.energy.total", "l")])));
        assert!(meters_load(&roles(&[("load.energy.today", "l")])));
    }

    fn keys(period: Period, zone: &str, from: &str, to: &str) -> Vec<String> {
        let zone = TimeZone::get(zone).expect("zone");
        let cut = Cut { period, zone: &zone, from: at(from), to: at(to) };
        energy_series(&cut, &BTreeMap::new(), false).into_iter().map(|p| p.bucket).collect()
    }

    #[test]
    fn a_day_with_no_data_is_zero_with_no_ratios() {
        let zone = TimeZone::UTC;
        let cut = Cut {
            period: Period::Day,
            zone: &zone,
            from: at("2026-05-01T00:00:00Z"),
            to: at("2026-05-02T00:00:00Z"),
        };
        let series = energy_series(&cut, &BTreeMap::new(), true);
        assert_eq!(series.len(), 1);
        assert_eq!(series[0].bucket, "2026-05-01");
        assert_eq!((series[0].import_kwh, series[0].load_kwh, series[0].production_kwh), (0.0, 0.0, 0.0));
        assert_eq!((series[0].self_sufficiency, series[0].self_consumption), (None, None));
    }

    #[test]
    fn a_window_clipping_a_day_by_more_than_half_leaves_it_out() {
        // Berlin, 28 March 2026: the day runs 23:00Z the 27th to 23:00Z the 28th, 24 hours.
        let from_noon = keys(Period::Day, "Europe/Berlin", "2026-03-28T11:00:00Z", "2026-03-29T22:00:00Z");
        assert_eq!(from_noon, ["2026-03-28", "2026-03-29"]);
        let after_noon = keys(Period::Day, "Europe/Berlin", "2026-03-28T11:00:01Z", "2026-03-29T22:00:00Z");
        assert_eq!(after_noon, ["2026-03-29"]);
    }

    #[test]
    fn a_window_shorter_than_half_a_period_is_its_own_period() {
        assert_eq!(keys(Period::Day, "UTC", "2026-05-01T02:00:00Z", "2026-05-01T04:00:00Z"), ["2026-05-01"]);
    }

    #[test]
    fn the_spring_day_has_23_hours_and_the_autumn_day_has_24_hour_keys_holding_25_hours() {
        let spring = keys(Period::Hour, "Europe/Berlin", "2026-03-28T23:00:00Z", "2026-03-29T22:00:00Z");
        assert_eq!(spring.len(), 23);
        assert!(!spring.contains(&"2026-03-29T02".to_owned()));
        let autumn = keys(Period::Hour, "Europe/Berlin", "2025-10-25T22:00:00Z", "2025-10-26T23:00:00Z");
        assert_eq!(autumn.len(), 24);
        assert_eq!(autumn.iter().filter(|k| *k == "2025-10-26T02").count(), 1);
    }

    #[test]
    fn a_year_sums_its_months_and_a_window_over_new_year_has_two() {
        let zone = TimeZone::UTC;
        let cut = Cut {
            period: Period::Year,
            zone: &zone,
            from: at("2025-12-01T00:00:00Z"),
            to: at("2026-02-01T00:00:00Z"),
        };
        let mut rises = BTreeMap::new();
        rises.insert(at("2025-12-31T00:00:00Z"), Totals { production: 4.0, ..Totals::default() });
        rises
            .insert(at("2026-01-01T00:00:00Z"), Totals { production: 5.0, export: 2.0, ..Totals::default() });
        let series = energy_series(&cut, &rises, false);
        let by_year: Vec<(&str, f64, f64)> =
            series.iter().map(|p| (p.bucket.as_str(), p.production_kwh, p.export_kwh)).collect();
        assert_eq!(by_year, [("2025", 4.0, 0.0), ("2026", 5.0, 2.0)]);
    }

    #[test]
    fn splits_follow_the_flows_and_ratios_stay_within_zero_and_one() {
        let totals = Totals {
            import: 3.0,
            export: 1.0,
            load: 10.0,
            production: 8.0,
            battery_discharge: 2.0,
            battery_charge: 0.0,
        };
        let p = PeriodEnergy::derive("k".into(), totals, false);
        // Solar to load is load less import (7); the battery serves 2 of it, solar direct the other 5.
        assert_eq!(
            (p.grid_to_load_kwh, p.solar_to_load_kwh, p.battery_to_load_kwh, p.solar_direct_to_load_kwh),
            (3.0, 7.0, 2.0, 5.0)
        );
        assert_eq!((p.self_consumed_kwh, p.exported_kwh), (7.0, 1.0));
        assert_eq!((p.self_sufficiency, p.self_consumption), (Some(0.7), Some(0.875)));
        let exporting = Totals { import: 0.0, export: 9.0, load: 0.0, production: 4.0, ..Totals::default() };
        let p = PeriodEnergy::derive("k".into(), exporting, false);
        assert_eq!((p.self_consumed_kwh, p.self_consumption, p.self_sufficiency), (0.0, Some(0.0), None));
    }

    #[test]
    fn an_implied_load_is_what_entered_less_what_left_and_never_negative() {
        let flows = Totals {
            import: 2.0,
            export: 1.0,
            production: 6.0,
            battery_discharge: 1.0,
            battery_charge: 3.0,
            load: 99.0,
        };
        assert_eq!(flows.with_implied_load().load, 5.0);
        let more_left = Totals { production: 1.0, export: 4.0, ..Totals::default() };
        assert_eq!(more_left.with_implied_load().load, 0.0);
    }
}
