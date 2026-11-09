//! Cost rates (ADR 12): what the plant pays, earns and saves, in EUR/h.

use std::time::SystemTime;

use super::Prices;
use crate::storage::ChangePoint;

/// Signed rates in EUR/h.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Rates {
    /// Paid for what is bought.
    pub import: f64,
    /// Earned for what is fed in.
    pub export: f64,
    /// The bill without the plant, every kWh of the house load bought, less the bill with it.
    pub savings: f64,
}

impl Rates {
    /// From the plant's `grid` power (W, positive importing), its house `load` (W) and the
    /// `prices` in force.
    #[must_use]
    pub fn of(grid: f64, load: f64, prices: Prices) -> Self {
        let (bought, sold) = (grid.max(0.0) / 1000.0, (-grid).max(0.0) / 1000.0);
        let import = bought * prices.import;
        let export = sold * prices.export;
        Self {
            import,
            export,
            savings: (load / 1000.0).mul_add(prices.import, export - import),
        }
    }
}

/// The rates over the change points of the plant's `grid.power` and `load.power` and of
/// `price.import` and `price.export`, each led by the one in force at `from`: one per instant
/// any input changes, from `from` on; `None` while any input is a gap or has no value yet.
#[must_use]
pub fn replay(inputs: [&[ChangePoint]; 4], from: SystemTime) -> Vec<(SystemTime, Option<Rates>)> {
    let mut changes: Vec<(SystemTime, usize, Option<f64>)> = inputs
        .iter()
        .enumerate()
        .flat_map(|(input, points)| {
            points
                .iter()
                .map(move |p| (p.time.max(from), input, p.value))
        })
        .collect();
    changes.sort_by_key(|&(time, ..)| time);
    let mut meter = Meter::default();
    changes
        .chunk_by(|a, b| a.0 == b.0)
        .filter_map(|group| {
            for &(_, input, value) in group {
                meter.set(input, value);
            }
            Some((group.first()?.0, meter.rates()))
        })
        .collect()
}

/// The latest value of each input: `grid.power`, `load.power`, `price.import`, `price.export`.
#[derive(Debug, Default)]
pub struct Meter([Option<f64>; 4]);

impl Meter {
    /// Sets the value of input `input`, by its place above; `None` is a gap.
    pub fn set(&mut self, input: usize, value: Option<f64>) {
        if let Some(slot) = self.0.get_mut(input) {
            *slot = value;
        }
    }

    /// The rates now; `None` while any input has no value.
    #[must_use]
    pub fn rates(&self) -> Option<Rates> {
        let [grid, load, import, export] = self.0;
        Some(Rates::of(
            grid?,
            load?,
            Prices {
                import: import?,
                export: export?,
            },
        ))
    }
}

#[cfg(test)]
mod tests;
