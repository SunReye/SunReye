//! The plant: which devices are its members and how their figures fold by role, ported from 3.x
//! (`apps/server/src/shared/plant-source.ts`, `plant-fold.ts`, `rollup-sql.ts`) and held against
//! `fixtures/oracle/README.md` §7.
//!
//! A controller present reports the total, so it is the whole member set; otherwise every inverter is a
//! member. Meters and chargers never are. History keeps a retired member, because its readings belong to
//! the plant for the span it was in service; the live set drops it. A member with nothing to say adds
//! nothing, never zero. Every member weighs 1: the core keeps no battery capacity.

use std::collections::BTreeMap;

use crate::profile::Profile;
use crate::recent::{Recent, Series};
use crate::rollup::Bucket;
use crate::store::DeviceRow;

/// How a role folds across members.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Aggregate {
    Sum,
    WeightedMean,
    /// One machine's own state: the plant has no value for it.
    PerDevice,
}

/// The roles that fold, from the 2.x role catalog; every other role is per device. Held against it by a test.
const ROLE_AGGREGATES: &[(&str, Aggregate)] = &[
    ("pv.total.power", Aggregate::Sum),
    ("production.today", Aggregate::Sum),
    ("production.total", Aggregate::Sum),
    ("battery.soc", Aggregate::WeightedMean),
    ("battery.power", Aggregate::Sum),
    ("battery.temperature", Aggregate::WeightedMean),
    ("battery.energy.charged.today", Aggregate::Sum),
    ("battery.energy.charged.total", Aggregate::Sum),
    ("battery.energy.discharged.today", Aggregate::Sum),
    ("battery.energy.discharged.total", Aggregate::Sum),
    ("grid.power", Aggregate::Sum),
    ("grid.energy.imported.today", Aggregate::Sum),
    ("grid.energy.imported.total", Aggregate::Sum),
    ("grid.energy.exported.today", Aggregate::Sum),
    ("grid.energy.exported.total", Aggregate::Sum),
    ("load.power", Aggregate::Sum),
    ("load.energy.today", Aggregate::Sum),
    ("load.energy.total", Aggregate::Sum),
    ("backup.power", Aggregate::Sum),
    ("backup.energy.today", Aggregate::Sum),
    ("backup.energy.total", Aggregate::Sum),
    ("generator.power", Aggregate::Sum),
    ("generator.energy.today", Aggregate::Sum),
    ("generator.energy.total", Aggregate::Sum),
    ("inverter.temperature.dc", Aggregate::WeightedMean),
    ("inverter.temperature.ac", Aggregate::WeightedMean),
    ("inverter.power", Aggregate::Sum),
    ("inverter.efficiency", Aggregate::WeightedMean),
];

fn role_aggregate(role: Option<&str>) -> Aggregate {
    let found = ROLE_AGGREGATES.iter().find(|(name, _)| Some(*name) == role);
    found.map_or(Aggregate::PerDevice, |(_, aggregate)| *aggregate)
}

/// Each metric key's aggregate, from the roles a profile gives its metrics; an unknown key is per device.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Aggregates(BTreeMap<String, Aggregate>);

impl Aggregates {
    pub fn of_roles<'a>(roles: impl IntoIterator<Item = (&'a str, Option<&'a str>)>) -> Self {
        Self(roles.into_iter().map(|(key, role)| (key.to_owned(), role_aggregate(role))).collect())
    }

    pub fn of_profile(profile: &Profile) -> Self {
        Self::of_roles(profile.metrics.iter().map(|m| (m.key.as_str(), m.role.as_deref())))
    }

    /// How `key` folds across `members` members. A plant of one member is that member: nothing is refused.
    pub fn of(&self, key: &str, members: usize) -> Aggregate {
        match self.0.get(key).copied().unwrap_or(Aggregate::PerDevice) {
            Aggregate::PerDevice if members == 1 => Aggregate::Sum,
            aggregate => aggregate,
        }
    }
}

/// The plant's members in roster order: with `live`, only the devices in service.
pub fn members(devices: &[DeviceRow], live: bool) -> Vec<&DeviceRow> {
    let pool = || devices.iter().filter(move |d| !live || d.in_service());
    let controllers: Vec<&DeviceRow> = pool().filter(|d| d.role == "controller").collect();
    if controllers.is_empty() { pool().filter(|d| d.role == "inverter").collect() } else { controllers }
}

/// One metric's members' values folded, in member order.
#[derive(Debug, Clone, Copy, Default)]
pub struct Fold {
    total: f64,
    count: u32,
}

impl Fold {
    pub fn add(&mut self, value: f64) {
        self.total += value;
        self.count += 1;
    }

    /// `None` when no member had a value.
    pub fn value(self, aggregate: Aggregate) -> Option<f64> {
        match aggregate {
            _ if self.count == 0 => None,
            Aggregate::WeightedMean => Some(self.total / f64::from(self.count)),
            _ => Some(self.total),
        }
    }
}

/// Each member's recent history on one grid: a member holds its last value until its next, from its first.
pub fn fold_recent(members: &[Recent], aggregates: &Aggregates, step: u32) -> Recent {
    let with_data: Vec<&Recent> = members.iter().filter(|m| !m.metrics.is_empty()).collect();
    let Some(t0) = with_data.iter().map(|m| m.t0).min() else {
        return Recent { t0: 0, step, metrics: BTreeMap::new() };
    };
    let step_ms = i64::from(step) * 1000;
    let mut metrics = BTreeMap::new();
    for key in with_data.iter().flat_map(|m| m.metrics.keys()) {
        let aggregate = aggregates.of(key, members.len());
        if aggregate == Aggregate::PerDevice || metrics.contains_key(key) {
            continue;
        }
        let parts: Vec<(i64, &Series)> = with_data
            .iter()
            .filter_map(|m| m.metrics.get(key).map(|s| ((m.t0 - t0).div_euclid(step_ms), s)))
            .collect();
        let series = on_grid(&parts, aggregate);
        if !series.o.is_empty() {
            metrics.insert(key.clone(), series);
        }
    }
    Recent { t0, step, metrics }
}

/// Walks every member's offsets in order, carrying each member's last value forward.
fn on_grid(parts: &[(i64, &Series)], aggregate: Aggregate) -> Series {
    let mut offsets: Vec<i64> =
        parts.iter().flat_map(|(shift, s)| s.o.iter().map(move |o| shift + i64::from(*o))).collect();
    offsets.sort_unstable();
    offsets.dedup();
    let mut next = vec![0; parts.len()];
    let mut held: Vec<Option<f64>> = vec![None; parts.len()];
    let mut out = Series { o: Vec::new(), v: Vec::new() };
    for offset in offsets {
        let mut fold = Fold::default();
        for (i, (shift, series)) in parts.iter().enumerate() {
            while next[i] < series.o.len() && shift + i64::from(series.o[next[i]]) <= offset {
                held[i] = Some(series.v[next[i]]).filter(|v| v.is_finite()).or(held[i]);
                next[i] += 1;
            }
            if let Some(value) = held[i] {
                fold.add(value);
            }
        }
        if let (Some(value), Ok(o)) = (fold.value(aggregate), u32::try_from(offset)) {
            out.o.push(o);
            out.v.push(value);
        }
    }
    out
}

/// Each member's buckets folded per bucket start: a sum adds avg, max and min; a mean averages avg and keeps
/// the members' extremes. A member without a bucket at a start adds nothing to it.
pub fn fold_buckets(members: Vec<Vec<Bucket>>, aggregate: Aggregate) -> Vec<Bucket> {
    let mut by_start: BTreeMap<jiff::Timestamp, (Fold, f64, f64)> = BTreeMap::new();
    for bucket in members.into_iter().flatten() {
        let (avg, max, min) = by_start.entry(bucket.start).or_insert((Fold::default(), 0.0, 0.0));
        let first = avg.count == 0;
        avg.add(bucket.avg);
        (*max, *min) = match aggregate {
            Aggregate::WeightedMean if first => (bucket.max, bucket.min),
            Aggregate::WeightedMean => (max.max(bucket.max), min.min(bucket.min)),
            _ => (*max + bucket.max, *min + bucket.min),
        };
    }
    by_start
        .into_iter()
        .filter_map(|(start, (avg, max, min))| {
            avg.value(aggregate).map(|avg| Bucket { start, avg, max, min })
        })
        .collect()
}

#[cfg(test)]
mod tests {

    use jiff::Timestamp;
    use serde_json::{Value, json};

    use super::*;
    use crate::modbus::Transport;
    use crate::oracle::{as_floats, oracle};
    use crate::rollup::{Tier, rollup};

    fn name(aggregate: Aggregate) -> &'static str {
        match aggregate {
            Aggregate::Sum => "sum",
            Aggregate::WeightedMean => "weighted-mean",
            Aggregate::PerDevice => "per-device",
        }
    }

    fn text(value: &Value) -> &str {
        value.as_str().expect("string")
    }

    fn device(row: &Value) -> DeviceRow {
        DeviceRow {
            id: text(&row["slug"]).parse().expect("id"),
            connection_id: 1,
            profile_id: text(&row["profileId"]).to_owned(),
            unit_id: 1,
            name: Some(text(&row["name"]).to_owned()),
            role: text(&row["role"]).to_owned(),
            retired_at: row["retiredAt"].as_str().map(str::to_owned),
            transport: Transport::Tcp,
            host: "h".into(),
            port: 502,
            logger_serial: None,
        }
    }

    pub(crate) fn aggregates(case: &Value) -> Aggregates {
        let roles = case["roles"].as_object().expect("roles");
        Aggregates::of_roles(roles.iter().map(|(key, role)| (key.as_str(), role.as_str())))
    }

    fn slugs(devices: &[&DeviceRow]) -> Value {
        devices.iter().map(|d| d.id.to_string()).collect()
    }

    fn recent(value: &Value) -> Recent {
        let numbers = |v: &Value| -> Vec<f64> {
            v.as_array().expect("array").iter().map(|n| n.as_f64().expect("number")).collect()
        };
        let metrics = value["metrics"].as_object().expect("metrics").iter().map(|(key, s)| {
            #[expect(
                clippy::cast_possible_truncation,
                clippy::cast_sign_loss,
                reason = "offsets are small whole numbers"
            )]
            let o = numbers(&s["o"]).into_iter().map(|o| o as u32).collect();
            (key.clone(), Series { o, v: numbers(&s["v"]) })
        });
        Recent {
            t0: value["t0"].as_i64().expect("t0"),
            step: u32::try_from(value["step"].as_u64().expect("step")).expect("step"),
            metrics: metrics.collect(),
        }
    }

    #[test]
    fn the_role_aggregates_are_the_2x_role_catalog() {
        let [catalog] = oracle("role-aggregates.ndjson").try_into().expect("one line");
        let catalog = catalog.as_object().expect("roles");
        for (role, aggregate) in catalog {
            assert_eq!(name(role_aggregate(Some(role))), aggregate, "{role}");
        }
        for (role, _) in ROLE_AGGREGATES {
            assert!(catalog.contains_key(*role), "{role} is no 2.x role");
        }
        assert_eq!(role_aggregate(None), Aggregate::PerDevice);
    }

    #[test]
    fn every_case_has_the_2x_history_and_live_members() {
        for case in oracle("plant.ndjson") {
            let devices: Vec<DeviceRow> =
                case["devices"].as_array().expect("devices").iter().map(device).collect();
            let got =
                json!({"history": slugs(&members(&devices, false)), "live": slugs(&members(&devices, true))});
            assert_eq!(got, case["members"], "{}", case["case"]);
        }
    }

    #[test]
    fn every_case_folds_recent_history_over_the_history_members_as_recorded() {
        for case in oracle("plant.ndjson") {
            let history: Vec<Recent> = case["members"]["history"]
                .as_array()
                .expect("members")
                .iter()
                .map(|slug| recent(&case["recent"][text(slug)]))
                .collect();
            let folded = fold_recent(&history, &aggregates(&case), 1);
            assert_eq!(
                as_floats(&serde_json::to_value(folded).expect("json")),
                as_floats(&case["plant"]["recent"]),
                "{}",
                case["case"]
            );
        }
    }

    #[test]
    fn a_plant_of_no_member_has_no_recent_history() {
        assert_eq!(
            fold_recent(&[], &Aggregates::default(), 5),
            Recent { t0: 0, step: 5, metrics: BTreeMap::new() }
        );
    }

    #[test]
    fn a_member_value_that_is_not_finite_holds_its_last_finite_one() {
        let aggregates =
            Aggregates::of_roles([("pv", Some("pv.total.power")), ("dead", Some("pv.total.power"))]);
        let member = |pv: Series, dead: Series| Recent {
            t0: 1_000,
            step: 1,
            metrics: BTreeMap::from([("pv".to_owned(), pv), ("dead".to_owned(), dead)]),
        };
        let members = [
            member(
                Series { o: vec![0, 1], v: vec![10.0, f64::NAN] },
                Series { o: vec![0], v: vec![f64::NAN] },
            ),
            member(Series { o: vec![1], v: vec![f64::INFINITY] }, Series { o: vec![1], v: vec![f64::NAN] }),
        ];
        let folded = fold_recent(&members, &aggregates, 1);
        assert_eq!(
            folded.metrics,
            BTreeMap::from([("pv".to_owned(), Series { o: vec![0, 1], v: vec![10.0, 10.0] })]),
            "a metric no member has a finite value for is absent"
        );
    }

    fn readings(series: &Value) -> Vec<(Timestamp, f64)> {
        let instant = |v: &Value| text(v).parse::<Timestamp>().expect("instant");
        series
            .as_array()
            .expect("readings")
            .iter()
            .map(|r| (instant(&r[0]), r[1].as_f64().expect("value")))
            .collect()
    }

    fn buckets(buckets: &[Bucket]) -> Value {
        buckets
            .iter()
            .map(|b| json!({"time": b.start.strftime("%Y-%m-%dT%H:%M:%S%.3fZ").to_string(), "avg": b.avg, "max": b.max, "min": b.min}))
            .collect()
    }

    fn member_minutes(member: &Value, metric: &str) -> Vec<Bucket> {
        member["readings"].get(metric).map(|r| rollup(Tier::Minute, &readings(r))).unwrap_or_default()
    }

    fn assert_rollups(case: &Value) {
        let devices = case["devices"].as_array().expect("devices");
        let members: Vec<&Value> = case["members"]
            .as_array()
            .expect("members")
            .iter()
            .map(|slug| devices.iter().find(|d| d["slug"] == *slug).expect("member"))
            .collect();
        for (metric, recorded) in case["minute"].as_object().expect("minute") {
            let label = format!("{} {metric}", case["case"]);
            let aggregate = aggregates(case).of(metric, members.len());
            if aggregate == Aggregate::PerDevice {
                assert!(recorded["refused"].is_string(), "{label}");
                continue;
            }
            let per_member = members.iter().map(|d| member_minutes(d, metric)).collect();
            assert_eq!(
                as_floats(&buckets(&fold_buckets(per_member, aggregate))),
                as_floats(recorded),
                "{label}"
            );
        }
    }

    #[test]
    fn every_case_folds_minute_rollups_over_the_history_members_as_recorded() {
        for case in oracle("plant-rollups.ndjson") {
            assert_rollups(&case);
        }
    }
}
