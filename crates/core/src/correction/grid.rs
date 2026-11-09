//! One MPPT input's learned correction (ADR 17): a multiplier per plant-local month and hour, the
//! decayed mean of measured over modelled power, carried over from 3.x and v4
//! (`crates/sunreye/src/forecast/correction.rs`).

/// Shrinks a cell's ratio toward 1 by `weight / (weight + K)`: a few stray hours cannot swing it.
const SHRINKAGE_K: f64 = 5.0;
/// A learned nudge, never an override.
const FACTOR_MIN: f64 = 0.6;
const FACTOR_MAX: f64 = 1.4;
/// A cell sees about one hour a day, so soiling and snow fade within a month.
const HALF_LIFE: f64 = 30.0;
/// One hour's ratio is clamped before it folds, so a glitch cannot drag a cell far.
const RATIO_MIN: f64 = 0.2;
const RATIO_MAX: f64 = 2.5;
/// Below this share of nameplate an hour is too dim to carry site signal.
const FLOOR: f64 = 0.03;
/// From this share of nameplate an hour is likely curtailed.
const SATURATION: f64 = 0.85;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Cell {
    /// Decayed mean of measured ÷ modelled.
    pub ratio: f64,
    /// Effective count of hours behind `ratio`.
    pub weight: f64,
}

/// One measured hour of an MPPT input against the model on archive weather, beside its
/// inverter's.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Hour {
    /// Plant-local month 1–12 and hour 0–23 the hour starts in.
    pub month: u8,
    pub hour: u8,
    /// Mean watts.
    pub modelled: f64,
    pub measured: f64,
    pub inverter_modelled: f64,
    /// None without a reading.
    pub inverter_measured: Option<f64>,
}

/// Cells by month and hour; an unlearned cell applies 1.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Grid {
    cells: [[Option<Cell>; 24]; 12],
}

fn decay() -> f64 {
    (-1.0 / HALF_LIFE).exp2()
}

impl Grid {
    /// Stores the cell for `month` 1–12 and `hour` 0–23; any other slot is ignored.
    pub fn set(&mut self, month: u8, hour: u8, cell: Cell) {
        if let Some(slot) = self.slot(month, hour) {
            *slot = Some(cell);
        }
    }

    /// Every learned cell as (month, hour, cell), in calendar order.
    pub fn cells(&self) -> impl Iterator<Item = (u8, u8, Cell)> + '_ {
        (1..=12).flat_map(move |month| {
            (0..24).filter_map(move |hour| Some((month, hour, self.cell(month, hour)?)))
        })
    }

    /// The multiplier for a plant-local month and hour.
    #[must_use]
    pub fn factor(&self, month: u8, hour: u8) -> f64 {
        let Some(cell) = self.cell(month, hour) else {
            return 1.0;
        };
        let shrunk = (cell.ratio - 1.0).mul_add(cell.weight / (cell.weight + SHRINKAGE_K), 1.0);
        shrunk.clamp(FACTOR_MIN, FACTOR_MAX)
    }

    /// Folds `hours` in order and returns the cells written, in calendar order. An hour is
    /// skipped when its inverter is likely curtailed, modelled or measured at 85 % of
    /// `inverter_nameplate` W or more, since a curtailed inverter holds each input below its
    /// maximum power point; or when the input is too dim (under 3 % of `input_nameplate` W),
    /// likely curtailed itself (85 %), measured negative, or not finite.
    pub fn learn(
        &mut self,
        hours: &[Hour],
        input_nameplate: f64,
        inverter_nameplate: f64,
    ) -> Vec<(u8, u8)> {
        let inverter_ceiling = inverter_nameplate * SATURATION;
        let floor = (input_nameplate * FLOOR).max(1.0);
        let ceiling = input_nameplate * SATURATION;
        let mut touched = std::collections::BTreeSet::new();
        for h in hours {
            let curtailed = h.inverter_modelled >= inverter_ceiling
                || h.inverter_measured.is_some_and(|w| w >= inverter_ceiling);
            let (modelled, measured) = (h.modelled, h.measured);
            let fit =
                modelled >= floor && measured >= 0.0 && modelled < ceiling && measured < ceiling;
            if curtailed || !fit || !modelled.is_finite() || !measured.is_finite() {
                continue;
            }
            let Some(slot) = self.slot(h.month, h.hour) else {
                continue;
            };
            let ratio = (measured / modelled).clamp(RATIO_MIN, RATIO_MAX);
            let w0 = slot.map_or(0.0, |cell| cell.weight * decay());
            let previous = slot.map_or(0.0, |cell| cell.ratio);
            *slot = Some(Cell {
                ratio: w0.mul_add(previous, ratio) / (w0 + 1.0),
                weight: w0 + 1.0,
            });
            touched.insert((h.month, h.hour));
        }
        touched.into_iter().collect()
    }

    fn cell(&self, month: u8, hour: u8) -> Option<Cell> {
        let (m, h) = index(month, hour)?;
        self.cells.get(m)?.get(h).copied().flatten()
    }

    fn slot(&mut self, month: u8, hour: u8) -> Option<&mut Option<Cell>> {
        let (m, h) = index(month, hour)?;
        self.cells.get_mut(m)?.get_mut(h)
    }
}

/// Zero-based (month, hour); none off the calendar.
fn index(month: u8, hour: u8) -> Option<(usize, usize)> {
    Some((usize::from(month.checked_sub(1)?), usize::from(hour)))
}

#[cfg(test)]
mod tests;
