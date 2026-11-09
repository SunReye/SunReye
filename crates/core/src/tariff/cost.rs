//! Cost rates (ADR 12): what the plant pays, earns and saves, in EUR/h.

use super::Prices;

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
