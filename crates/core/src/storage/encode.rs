//! Change points from readings: the deadband, gaps and the clock rule, per series.

use std::time::Duration;

use super::Policy;

/// 100 ms ticks since the Unix epoch.
pub type Tick = i64;

/// The gap threshold's floor.
const MIN_GAP: Duration = Duration::from_secs(15);
/// The largest integer an `f64` holds exactly.
const MAX_VALUE: f64 = 9_007_199_254_740_992.0;

/// A stored change point: a quantised value, or a gap, from an instant on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Point {
    pub time: Tick,
    /// In steps of the series; `None` is a gap.
    pub value: Option<i64>,
}

/// The encoder of one series.
#[derive(Debug)]
pub struct Track {
    step: f64,
    /// In steps.
    deadband: i64,
    cadence: Tick,
    threshold: Tick,
    /// The last stored value: the deadband's reference. `None` before history or after a gap.
    stored: Option<i64>,
    /// The last reading's instant.
    seen: Option<Tick>,
    /// A reading went back in time since `seen`.
    stepped: bool,
}

pub fn ticks(duration: Duration) -> Tick {
    Tick::try_from(duration.as_millis() / 100).unwrap_or(Tick::MAX)
}

impl Track {
    pub fn new(policy: &Policy) -> Self {
        let ratio = policy.deadband / policy.step;
        let nearest = ratio.round();
        // A deadband of 0.5 V on a 0.1 V step is 5 steps, whatever the float division says.
        let deadband = if (ratio - nearest).abs() < 1e-6 {
            nearest
        } else {
            ratio.ceil()
        };
        let cadence = ticks(policy.cadence);
        Self {
            step: policy.step,
            #[expect(clippy::cast_possible_truncation, reason = "a deadband is small")]
            deadband: deadband as i64,
            cadence,
            threshold: cadence.saturating_mul(3).max(ticks(MIN_GAP)),
            stored: None,
            seen: None,
            stepped: false,
        }
    }

    /// A track after a restart: `last` is its last stored point and `flushed` the last flush,
    /// until which a value still held is taken as read.
    pub fn resume(policy: &Policy, last: Option<Point>, flushed: Tick) -> Self {
        let mut track = Self::new(policy);
        if let Some(last) = last {
            track.stored = last.value;
            track.seen = Some(last.time.max(flushed));
        }
        track
    }

    /// The deadband's reference after stored history was replaced: `value` is now last stored.
    pub const fn rebase(&mut self, value: Option<i64>) {
        self.stored = value;
    }

    pub fn reading(&mut self, time: Tick, value: f64, out: &mut Vec<Point>) {
        let Some(value) = self.quantise(value) else {
            return;
        };
        if !self.admit(time, out) {
            return;
        }
        self.stepped = false;
        self.seen = Some(time);
        let changed = self.stored.is_none_or(|stored| {
            let delta = value.abs_diff(stored);
            delta != 0 && delta >= self.deadband.unsigned_abs()
        });
        if changed {
            self.stored = Some(value);
            out.push(Point {
                time,
                value: Some(value),
            });
        }
    }

    /// The value last read was held until `until`, as an imported row records (ADR 18): no
    /// silence before it.
    pub const fn held(&mut self, until: Tick) {
        if let Some(seen) = self.seen
            && until > seen
        {
            self.seen = Some(until);
        }
    }

    /// Whether a reading at `time` may be stored, after the gap a silence or a clock step needs.
    fn admit(&mut self, time: Tick, out: &mut Vec<Point>) -> bool {
        let Some(seen) = self.seen else {
            return true;
        };
        if time <= seen {
            self.stepped |= time < seen;
            return false;
        }
        let silent = self.stepped || time - seen > self.threshold;
        if silent && self.stored.is_some() {
            // Nothing is written at or before the last stored instant.
            let end = seen.saturating_add(self.cadence);
            if time <= end {
                return false;
            }
            self.gap(end, out);
        }
        true
    }

    /// Closes the value with a gap if the series has been silent past the threshold at `now`.
    pub fn silence(&mut self, now: Tick, out: &mut Vec<Point>) {
        if let Some(seen) = self.seen
            && self.stored.is_some()
            && now - seen > self.threshold
        {
            self.gap(seen.saturating_add(self.cadence), out);
        }
    }

    fn gap(&mut self, time: Tick, out: &mut Vec<Point>) {
        self.stored = None;
        out.push(Point { time, value: None });
    }

    fn quantise(&self, value: f64) -> Option<i64> {
        quantise(value, self.step)
    }
}

/// `value` in whole steps; `None` when not finite or beyond ±2^53.
pub fn quantise(value: f64, step: f64) -> Option<i64> {
    let steps = (value / step).round();
    #[expect(clippy::cast_possible_truncation, reason = "bounded to ±2^53 first")]
    (steps.abs() <= MAX_VALUE).then_some(steps as i64)
}

#[cfg(test)]
mod tests;
