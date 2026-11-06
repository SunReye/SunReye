//! The learned site correction (3.x `forecast-correction.ts`): one multiplier per plant-local (month, hour),
//! a decayed mean of measured over modelled output on reanalysis weather. Held to
//! `fixtures/oracle/forecast-correction.ndjson`.

use std::collections::BTreeSet;

/// Shrinks a cell's ratio toward 1 by `weight / (weight + K)`: a few stray hours cannot swing it.
const SHRINKAGE_K: f64 = 5.0;
/// A learned nudge, never an override.
const FACTOR_MIN: f64 = 0.6;
const FACTOR_MAX: f64 = 1.4;
/// Forgetting horizon in observations: a cell sees about one a day, so soiling and snow fade in a month.
const HALF_LIFE_OBS: f64 = 30.0;
/// One observation's ratio is clamped before it folds, so a glitch cannot drag a cell far.
const RATIO_OBS_MIN: f64 = 0.2;
const RATIO_OBS_MAX: f64 = 2.5;
/// Below this share of nameplate an hour is too dim to carry site signal.
const EXPECTED_FLOOR_FRAC: f64 = 0.03;
/// From this share of nameplate, or the feed-in cap if lower, an hour is likely curtailed.
const SATURATION_FRAC: f64 = 0.85;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CorrectionCell {
    /// Decayed mean of `actual / expected`.
    pub ratio: f64,
    /// Effective sample count behind `ratio`.
    pub weight: f64,
}

/// Decayed mean absolute error of the forecast without and with the correction, W.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct Skill {
    pub mae_raw: f64,
    pub mae_corrected: f64,
    /// Effective sample count behind both means.
    pub samples: f64,
}

impl Skill {
    /// Percentage the correction cuts the error by; 0 without samples or raw error.
    pub fn improvement_pct(&self) -> f64 {
        if self.samples <= 0.0 || self.mae_raw <= 0.0 {
            return 0.0;
        }
        (self.mae_raw - self.mae_corrected) / self.mae_raw * 100.0
    }

    fn fold(self, err_raw: f64, err_corrected: f64) -> Self {
        let w0 = self.samples * decay();
        Self {
            mae_raw: (w0 * self.mae_raw + err_raw) / (w0 + 1.0),
            mae_corrected: (w0 * self.mae_corrected + err_corrected) / (w0 + 1.0),
            samples: w0 + 1.0,
        }
    }
}

/// One measured hour against the model's expectation on reanalysis weather for it.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Observation {
    /// Plant-local month 1–12 and hour 0–23 the hour starts in.
    pub month: i8,
    pub hour: i8,
    /// Average AC power the model expects over the hour, W.
    pub expected_w: f64,
    /// Average power measured over the hour, W.
    pub actual_w: f64,
}

/// One hour of an array wired to its own MPPT string, beside its inverter's total.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct StringObservation {
    /// The array's modelled hour against the string's measured `pv.string.power`.
    pub array: Observation,
    /// The inverter's modelled total, W.
    pub inverter_expected_w: f64,
    /// The inverter's measured total, W; none without a reading.
    pub inverter_actual_w: Option<f64>,
}

/// What one fold changed.
#[derive(Debug, Clone, PartialEq)]
pub struct Learned {
    /// (month, hour) of every cell the fold wrote, in calendar order.
    pub touched: BTreeSet<(i8, i8)>,
    pub skill: Skill,
}

/// Cells by month 1–12 and hour 0–23; an unlearned cell applies 1.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct CorrectionModel {
    cells: [[Option<CorrectionCell>; 24]; 12],
}

fn decay() -> f64 {
    2f64.powf(-1.0 / HALF_LIFE_OBS)
}

impl CorrectionModel {
    /// Stores the cell for `month` 1–12 and `hour` 0–23; any other slot does not exist and is ignored.
    pub fn set(&mut self, month: i8, hour: i8, cell: CorrectionCell) {
        if let Some(slot) = self.slot(month, hour) {
            *slot = Some(cell);
        }
    }

    pub fn cell(&self, month: i8, hour: i8) -> Option<CorrectionCell> {
        index(month, hour).and_then(|(m, h)| self.cells.get(m)?.get(h).copied().flatten())
    }

    /// Every learned cell as (month, hour, cell), in calendar order.
    pub fn cells(&self) -> impl Iterator<Item = (i8, i8, CorrectionCell)> + '_ {
        (1..=12_i8).flat_map(move |month| {
            (0..24_i8).filter_map(move |hour| self.cell(month, hour).map(|cell| (month, hour, cell)))
        })
    }

    pub fn is_empty(&self) -> bool {
        self.cells().next().is_none()
    }

    /// The multiplier for a plant-local (month, hour).
    pub fn factor(&self, month: i8, hour: i8) -> f64 {
        let Some(cell) = self.cell(month, hour) else { return 1.0 };
        let shrunk = 1.0 + (cell.ratio - 1.0) * (cell.weight / (cell.weight + SHRINKAGE_K));
        shrunk.clamp(FACTOR_MIN, FACTOR_MAX)
    }

    /// Folds `observations` in order. Too dim, likely curtailed, non-finite and off-calendar hours are skipped.
    /// Each hour's corrected error uses its cell's factor from before the hour folds, so the skill measures
    /// prediction, not fit. `nameplate_w` is the arrays' kWp × 1000; `export_cap_w` the feed-in cap.
    pub fn learn(
        &mut self,
        skill: Skill,
        observations: &[Observation],
        nameplate_w: f64,
        export_cap_w: Option<f64>,
    ) -> Learned {
        let floor = (nameplate_w * EXPECTED_FLOOR_FRAC).max(1.0);
        let ceiling = (nameplate_w * SATURATION_FRAC).min(export_cap_w.unwrap_or(f64::INFINITY));
        let mut learned = Learned { touched: BTreeSet::new(), skill };
        for obs in observations {
            let (expected, actual) = (obs.expected_w, obs.actual_w);
            let fit = expected >= floor && actual >= 0.0 && expected < ceiling && actual < ceiling;
            if !fit || !expected.is_finite() || !actual.is_finite() {
                continue;
            }
            let factor = self.factor(obs.month, obs.hour);
            let Some(slot) = self.slot(obs.month, obs.hour) else { continue };
            learned.skill = learned.skill.fold((expected - actual).abs(), (expected * factor - actual).abs());
            let ratio = (actual / expected).clamp(RATIO_OBS_MIN, RATIO_OBS_MAX);
            let w0 = slot.map_or(0.0, |cell| cell.weight * decay());
            let previous = slot.map_or(0.0, |cell| cell.ratio);
            *slot = Some(CorrectionCell { ratio: (w0 * previous + ratio) / (w0 + 1.0), weight: w0 + 1.0 });
            learned.touched.insert((obs.month, obs.hour));
        }
        learned
    }

    /// Folds a string's hours against its array's nameplate, skipping every hour the inverter is likely
    /// curtailed in: a curtailed inverter holds each string below its maximum power point. Returns the cells
    /// written; the string keeps no skill.
    pub fn learn_string(
        &mut self,
        observations: &[StringObservation],
        array_nameplate_w: f64,
        inverter_nameplate_w: f64,
        export_cap_w: Option<f64>,
    ) -> BTreeSet<(i8, i8)> {
        let ceiling = (inverter_nameplate_w * SATURATION_FRAC).min(export_cap_w.unwrap_or(f64::INFINITY));
        let fit: Vec<Observation> = observations
            .iter()
            .filter(|o| o.inverter_expected_w < ceiling && o.inverter_actual_w.is_none_or(|w| w < ceiling))
            .map(|o| o.array)
            .collect();
        self.learn(Skill::default(), &fit, array_nameplate_w, None).touched
    }

    fn slot(&mut self, month: i8, hour: i8) -> Option<&mut Option<CorrectionCell>> {
        let (m, h) = index(month, hour)?;
        self.cells.get_mut(m)?.get_mut(h)
    }
}

/// Zero-based (month, hour); `None` below the calendar, including `i8::MIN`.
fn index(month: i8, hour: i8) -> Option<(usize, usize)> {
    Some((usize::try_from(month.checked_sub(1)?).ok()?, usize::try_from(hour).ok()?))
}

#[cfg(test)]
mod tests {
    use super::*;

    const HOUR: Observation = Observation { month: 7, hour: 13, expected_w: 5000.0, actual_w: 4000.0 };

    #[test]
    fn non_finite_and_off_calendar_observations_leave_the_model_and_skill_alone() {
        let mut model = CorrectionModel::default();
        let skipped = [
            Observation { actual_w: f64::NAN, ..HOUR },
            Observation { actual_w: f64::INFINITY, ..HOUR },
            Observation { expected_w: f64::NAN, ..HOUR },
            Observation { expected_w: f64::INFINITY, ..HOUR },
            Observation { month: 13, ..HOUR },
            Observation { month: 0, ..HOUR },
            Observation { hour: 24, ..HOUR },
            Observation { hour: -1, ..HOUR },
        ];
        let learned = model.learn(Skill::default(), &skipped, 10_000.0, None);
        assert_eq!(learned, Learned { touched: BTreeSet::new(), skill: Skill::default() });
        assert!(model.is_empty());
    }

    #[test]
    fn a_first_fold_takes_the_observed_ratio_with_weight_one() {
        let mut model = CorrectionModel::default();
        let learned = model.learn(Skill::default(), &[HOUR], 10_000.0, None);
        assert_eq!(model.cell(7, 13), Some(CorrectionCell { ratio: 0.8, weight: 1.0 }));
        assert_eq!(learned.touched, BTreeSet::from([(7, 13)]));
        assert_eq!(learned.skill, Skill { mae_raw: 1000.0, mae_corrected: 1000.0, samples: 1.0 });
    }
}
