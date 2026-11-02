//! The live window: the last seconds of one device's readings, one value per metric per step, for the
//! dashboard's sparklines (`/api/history/recent`).
//!
//! A step is a bucket of epoch-aligned seconds and keeps its last reading. A metric that held one value
//! since before the window opened still draws from the window's left edge: the newest reading in the
//! five minutes before it opens the first bucket, unless a reading of its own is already there. An
//! older reading is not carried in, so a device that stopped answering is not shown as steady.

use std::collections::BTreeMap;

use serde::Serialize;
use utoipa::ToSchema;

use crate::samples::{Sample, SampleError};

/// How far before the window a reading may sit and still be what a metric was holding when it opened.
pub const LOOKBACK_MS: i64 = 300_000;
/// Most points one answer holds, so a read stays bounded however many metrics and polls fill the window.
pub const MAX_POINTS: usize = 60_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Window {
    /// Unix milliseconds the window ends at.
    pub now_ms: i64,
    pub seconds: u32,
    pub step: u32,
}

/// One metric's points: `o[i]` steps after `t0`, holding `v[i]`.
impl Window {
    /// Unix milliseconds the window opens at.
    pub fn since_ms(self) -> i64 {
        self.now_ms - i64::from(self.seconds) * 1000
    }

    /// The earliest reading that can matter: what a metric was holding when the window opened.
    pub fn reach_ms(self) -> i64 {
        self.since_ms() - LOOKBACK_MS
    }
}

#[derive(Debug, PartialEq, Serialize, ToSchema)]
pub struct Series {
    pub o: Vec<u32>,
    pub v: Vec<f64>,
}

/// Every point is at `t0 + o[i] * step * 1000` milliseconds, so no timestamp repeats.
#[derive(Debug, PartialEq, Serialize, ToSchema)]
pub struct Recent {
    pub t0: i64,
    pub step: u32,
    pub metrics: BTreeMap<String, Series>,
}

#[derive(Debug, thiserror::Error)]
pub enum RecentError {
    #[error("the window holds more than {MAX_POINTS} points")]
    TooDense,
    #[error(transparent)]
    Sample(#[from] SampleError),
}

/// Folds `samples`, oldest first, into the window.
pub fn fold(
    window: Window,
    samples: impl IntoIterator<Item = Result<Sample, SampleError>>,
) -> Result<Recent, RecentError> {
    let mut folder = Folder::new(window);
    for sample in samples {
        folder.add(&sample?)?;
    }
    Ok(folder.finish())
}

/// A metric's points: step index since the epoch, then the value.
type Points = Vec<(i64, f64)>;

struct Folder {
    step: u32,
    step_ms: i64,
    since: i64,
    now: i64,
    points: BTreeMap<String, Points>,
    /// The newest reading before the window of each metric, within the lookback.
    held: BTreeMap<String, f64>,
    count: usize,
}

impl Folder {
    fn new(window: Window) -> Self {
        Self {
            step: window.step,
            step_ms: i64::from(window.step) * 1000,
            since: window.since_ms(),
            now: window.now_ms,
            points: BTreeMap::new(),
            held: BTreeMap::new(),
            count: 0,
        }
    }

    fn add(&mut self, sample: &Sample) -> Result<(), RecentError> {
        let values = sample.values.iter().filter(|(_, value)| value.is_finite());
        if sample.at_ms > self.now || sample.at_ms < self.since - LOOKBACK_MS {
            return Ok(());
        }
        if sample.at_ms < self.since {
            for (key, value) in values {
                self.held.insert(key.clone(), *value);
            }
            return Ok(());
        }
        let index = sample.at_ms.div_euclid(self.step_ms);
        for (key, value) in values {
            self.put(key, index, *value);
        }
        if self.count > MAX_POINTS { Err(RecentError::TooDense) } else { Ok(()) }
    }

    fn put(&mut self, key: &str, index: i64, value: f64) {
        if !self.points.contains_key(key) {
            self.points.insert(key.to_owned(), Vec::new());
        }
        let Some(points) = self.points.get_mut(key) else { return };
        match points.last_mut() {
            Some(last) if last.0 == index => last.1 = value,
            _ => {
                points.push((index, value));
                self.count += 1;
            }
        }
    }

    /// Opens each metric's first step with what it held before the window, unless it has a reading there.
    fn seed(&mut self) {
        let index = self.since.div_euclid(self.step_ms);
        for (key, value) in std::mem::take(&mut self.held) {
            let points = self.points.entry(key).or_default();
            if points.first().is_none_or(|first| first.0 > index) {
                points.insert(0, (index, value));
            }
        }
    }

    fn finish(mut self) -> Recent {
        self.seed();
        let Some(first) = self.points.values().filter_map(|points| points.first()).map(|p| p.0).min() else {
            return Recent { t0: 0, step: self.step, metrics: BTreeMap::new() };
        };
        let offset = |index: i64| u32::try_from(index - first).unwrap_or(u32::MAX);
        let metrics = self
            .points
            .into_iter()
            .map(|(key, points)| {
                let series = Series {
                    o: points.iter().map(|(index, _)| offset(*index)).collect(),
                    v: points.iter().map(|(_, value)| *value).collect(),
                };
                (key, series)
            })
            .collect();
        Recent { t0: first * self.step_ms, step: self.step, metrics }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 2026-03-01T00:02:30Z.
    const NOW: i64 = 1_772_323_350_000;
    /// 2026-03-01T00:00:00Z, a day boundary.
    const MIDNIGHT: i64 = 1_772_323_200_000;
    const SINCE: i64 = NOW - 300_000;

    fn at(at_ms: i64, values: &[(&str, f64)]) -> Sample {
        Sample { at_ms, values: values.iter().map(|(k, v)| ((*k).to_owned(), *v)).collect() }
    }

    fn window(now_ms: i64, seconds: u32, step: u32) -> Window {
        Window { now_ms, seconds, step }
    }

    fn fold_of(window: Window, samples: Vec<Sample>) -> Recent {
        fold(window, samples.into_iter().map(Ok)).expect("fold")
    }

    fn series(recent: &Recent, key: &str) -> (Vec<u32>, Vec<f64>) {
        let series = recent.metrics.get(key).unwrap_or_else(|| panic!("{key} is absent"));
        (series.o.clone(), series.v.clone())
    }

    #[test]
    fn no_readings_answer_a_finite_origin_and_no_metrics() {
        assert_eq!(fold_of(window(NOW, 300, 1), vec![]), Recent { t0: 0, step: 1, metrics: BTreeMap::new() });
        assert_eq!(fold_of(window(NOW, 300, 60), vec![]).step, 60);
    }

    #[test]
    fn each_metric_keeps_its_own_points_from_the_first_bucket() {
        let recent = fold_of(
            window(NOW, 300, 1),
            vec![
                at(NOW - 30_000, &[("pv", 100.0)]),
                at(NOW - 20_000, &[("pv", 200.0)]),
                at(NOW - 10_000, &[("load", 50.0)]),
            ],
        );
        assert_eq!(recent.t0, NOW - 30_000);
        assert_eq!(series(&recent, "pv"), (vec![0, 10], vec![100.0, 200.0]));
        assert_eq!(series(&recent, "load"), (vec![20], vec![50.0]));
        assert_eq!(recent.metrics.keys().collect::<Vec<_>>(), ["load", "pv"]);
    }

    #[test]
    fn a_window_crossing_midnight_is_one_unbroken_run_of_buckets() {
        let recent = fold_of(
            window(NOW, 300, 1),
            vec![
                at(MIDNIGHT - 10_000, &[("pv", 100.0)]),
                at(MIDNIGHT, &[("pv", 200.0)]),
                at(MIDNIGHT + 999, &[("pv", 300.0)]),
                at(NOW, &[("pv", -50.0)]),
            ],
        );
        assert_eq!(recent.t0, MIDNIGHT - 10_000);
        assert_eq!(series(&recent, "pv"), (vec![0, 10, 160], vec![100.0, 300.0, -50.0]));
    }

    #[test]
    fn the_last_reading_in_a_step_wins_and_a_reading_on_the_boundary_opens_the_next() {
        let five = fold_of(
            window(NOW, 300, 5),
            vec![
                at(MIDNIGHT + 1_000, &[("pv", 1.0)]),
                at(MIDNIGHT + 4_999, &[("pv", 2.0)]),
                at(MIDNIGHT + 5_000, &[("pv", 3.0)]),
            ],
        );
        assert_eq!(five.t0, MIDNIGHT);
        assert_eq!(series(&five, "pv"), (vec![0, 1], vec![2.0, 3.0]));

        let minute = fold_of(
            window(NOW, 300, 60),
            vec![at(MIDNIGHT - 1, &[("pv", 1.0)]), at(MIDNIGHT, &[("pv", 2.0)])],
        );
        assert_eq!(minute.t0, MIDNIGHT - 60_000);
        assert_eq!(series(&minute, "pv"), (vec![0, 1], vec![1.0, 2.0]));
    }

    #[test]
    fn zero_and_negative_values_are_readings() {
        let recent = fold_of(
            window(NOW, 300, 1),
            vec![at(NOW - 3_000, &[("p", 0.0)]), at(NOW - 2_000, &[("p", -1.5)])],
        );
        assert_eq!(series(&recent, "p"), (vec![0, 1], vec![0.0, -1.5]));
    }

    #[test]
    fn a_gap_is_a_jump_in_the_offsets_not_a_filled_run() {
        let recent = fold_of(
            window(NOW, 300, 1),
            vec![
                at(NOW - 100_000, &[("pv", 1.0)]),
                at(NOW - 99_000, &[("pv", 2.0)]),
                at(NOW - 10_000, &[("pv", 3.0)]),
            ],
        );
        assert_eq!(series(&recent, "pv"), (vec![0, 1, 90], vec![1.0, 2.0, 3.0]));
    }

    #[test]
    fn a_sample_without_a_metric_leaves_that_metric_out_of_its_step() {
        let recent = fold_of(
            window(NOW, 300, 1),
            vec![at(NOW - 2_000, &[("a", 1.0), ("b", 2.0)]), at(NOW - 1_000, &[("a", 3.0)])],
        );
        assert_eq!(series(&recent, "a"), (vec![0, 1], vec![1.0, 3.0]));
        assert_eq!(series(&recent, "b"), (vec![0], vec![2.0]));
    }

    #[test]
    fn a_reading_in_a_partial_window_still_starts_at_its_own_bucket() {
        let recent = fold_of(window(NOW, 3600, 1), vec![at(NOW - 5_000, &[("pv", 7.0)])]);
        assert_eq!(recent.t0, NOW - 5_000);
        assert_eq!(series(&recent, "pv"), (vec![0], vec![7.0]));
    }

    #[test]
    fn a_metric_that_held_one_value_before_the_window_opens_the_first_bucket_with_its_newest() {
        let recent = fold_of(
            window(NOW, 300, 1),
            vec![
                at(SINCE - 100_000, &[("held", 11.0)]),
                at(SINCE - 60_000, &[("held", 22.0)]),
                at(SINCE - 20_000, &[("held", 33.0)]),
            ],
        );
        assert_eq!(recent.t0, SINCE);
        assert_eq!(series(&recent, "held"), (vec![0], vec![33.0]));
    }

    #[test]
    fn the_lookback_reaches_five_minutes_before_the_window_and_no_further() {
        let edge = fold_of(window(NOW, 300, 1), vec![at(SINCE - LOOKBACK_MS, &[("a", 1.0)])]);
        assert_eq!(series(&edge, "a"), (vec![0], vec![1.0]));
        let past = fold_of(window(NOW, 300, 1), vec![at(SINCE - LOOKBACK_MS - 1, &[("a", 1.0)])]);
        assert!(past.metrics.is_empty(), "stale: nothing stands for it");
        assert_eq!(past.t0, 0);
    }

    #[test]
    fn a_reading_older_than_the_lookback_is_stale_across_midnight_and_a_nearer_one_is_not() {
        let recent = fold_of(window(NOW, 60, 1), vec![at(MIDNIGHT - 400_000, &[("pv", 5.0)])]);
        assert!(recent.metrics.is_empty());
        let near = fold_of(window(NOW, 60, 1), vec![at(NOW - 60_000 - 200_000, &[("pv", 5.0)])]);
        assert_eq!(series(&near, "pv").1, [5.0]);
    }

    #[test]
    fn a_reading_at_the_window_start_is_in_it_and_one_millisecond_earlier_is_only_a_seed() {
        let recent =
            fold_of(window(NOW, 300, 1), vec![at(SINCE - 1, &[("a", 1.0)]), at(SINCE, &[("a", 2.0)])]);
        assert_eq!(series(&recent, "a"), (vec![0], vec![2.0]), "the reading, not the carried value");
        let alone = fold_of(window(NOW, 300, 1), vec![at(SINCE - 1, &[("a", 1.0)])]);
        assert_eq!(series(&alone, "a"), (vec![0], vec![1.0]));
        assert_eq!(alone.t0, SINCE);
    }

    #[test]
    fn a_window_opening_mid_step_seeds_that_step_and_a_reading_of_its_own_wins_it() {
        let since = SINCE + 400;
        let seed_only = fold_of(window(NOW + 400, 300, 1), vec![at(since - 300, &[("a", 1.0)])]);
        assert_eq!((seed_only.t0, series(&seed_only, "a")), (SINCE, (vec![0], vec![1.0])));
        let own = fold_of(
            window(NOW + 400, 300, 1),
            vec![at(since - 300, &[("a", 1.0)]), at(since + 100, &[("a", 9.0)])],
        );
        assert_eq!(series(&own, "a"), (vec![0], vec![9.0]));
    }

    #[test]
    fn a_stale_seed_never_outlives_newer_readings_but_precedes_them() {
        let recent = fold_of(
            window(NOW, 300, 1),
            vec![
                at(SINCE - 100_000, &[("wins", 1.0)]),
                at(SINCE, &[("wins", 999.0)]),
                at(SINCE + 1_500, &[("wins", 999.0)]),
            ],
        );
        assert_eq!(series(&recent, "wins"), (vec![0, 1], vec![999.0, 999.0]));

        let later = fold_of(
            window(NOW, 300, 1),
            vec![at(SINCE - 100_000, &[("wins", 1.0)]), at(SINCE + 1_500, &[("wins", 2.0)])],
        );
        assert_eq!(series(&later, "wins"), (vec![0, 1], vec![1.0, 2.0]));
    }

    #[test]
    fn readings_after_the_window_end_are_ignored() {
        let recent = fold_of(
            window(NOW, 300, 1),
            vec![at(NOW, &[("a", 1.0)]), at(NOW + 1, &[("a", 2.0), ("b", 3.0)])],
        );
        assert_eq!(series(&recent, "a"), (vec![0], vec![1.0]));
        assert!(!recent.metrics.contains_key("b"));
    }

    #[test]
    fn a_value_json_cannot_carry_is_dropped_with_its_metric_when_nothing_else_remains() {
        let recent = fold_of(
            window(NOW, 300, 1),
            vec![at(NOW - 2_000, &[("a", f64::NAN), ("b", 1.0)]), at(NOW - 1_000, &[("a", f64::INFINITY)])],
        );
        assert!(!recent.metrics.contains_key("a"));
        assert_eq!(series(&recent, "b"), (vec![0], vec![1.0]));
    }

    #[test]
    fn a_window_holding_more_points_than_the_bound_is_refused() {
        let keys: Vec<String> = (0..100).map(|n| format!("m{n}")).collect();
        let sample = |second: i64| Sample {
            at_ms: NOW - 3_600_000 + second * 1_000,
            values: keys.iter().map(|k| (k.clone(), 1.0)).collect(),
        };
        let fits = (0..600).map(|s| Ok(sample(s)));
        assert!(fold(window(NOW, 3600, 1), fits).is_ok());
        let over = (0..601).map(|s| Ok(sample(s)));
        assert!(matches!(fold(window(NOW, 3600, 1), over), Err(RecentError::TooDense)));
    }

    #[test]
    fn a_corrupt_minute_is_the_samples_error() {
        let corrupt = vec![Err(SampleError::Corrupt("truncated"))];
        assert!(matches!(fold(window(NOW, 300, 1), corrupt), Err(RecentError::Sample(_))));
    }
}
