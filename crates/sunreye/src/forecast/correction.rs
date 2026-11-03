//! The learned site correction, read side: one multiplier per plant-local (month, hour).

/// Shrinks a cell's ratio toward 1 by `weight / (weight + K)`: a few stray hours cannot swing it.
const SHRINKAGE_K: f64 = 5.0;
/// A learned nudge, never an override.
const FACTOR_MIN: f64 = 0.6;
const FACTOR_MAX: f64 = 1.4;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CorrectionCell {
    /// Decayed mean of `actual / expected`.
    pub ratio: f64,
    /// Effective sample count behind `ratio`.
    pub weight: f64,
}

/// Cells by month 1–12 and hour 0–23; an unlearned cell applies 1.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct CorrectionModel {
    cells: [[Option<CorrectionCell>; 24]; 12],
}

impl CorrectionModel {
    /// Stores the cell for `month` 1–12 and `hour` 0–23; any other slot does not exist and is ignored.
    pub fn set(&mut self, month: i8, hour: i8, cell: CorrectionCell) {
        if let Some(slot) = self.slot(month, hour) {
            *slot = Some(cell);
        }
    }

    /// The multiplier for a plant-local (month, hour).
    pub fn factor(&self, month: i8, hour: i8) -> f64 {
        let cell = usize::try_from(month - 1)
            .ok()
            .zip(usize::try_from(hour).ok())
            .and_then(|(m, h)| self.cells.get(m)?.get(h).copied().flatten());
        let Some(cell) = cell else { return 1.0 };
        let shrunk = 1.0 + (cell.ratio - 1.0) * (cell.weight / (cell.weight + SHRINKAGE_K));
        shrunk.clamp(FACTOR_MIN, FACTOR_MAX)
    }

    fn slot(&mut self, month: i8, hour: i8) -> Option<&mut Option<CorrectionCell>> {
        let (m, h) = (usize::try_from(month - 1).ok()?, usize::try_from(hour).ok()?);
        self.cells.get_mut(m)?.get_mut(h)
    }
}
