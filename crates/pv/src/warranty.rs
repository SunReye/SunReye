//! Degradation (ADR 17): a module type's linear performance warranty gives the yield of each year
//! after the first.

/// What a module's power keeps by its performance warranty: it loses `first_year` % in its first
/// year and `yearly` % of its new power in each later year.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Warranty {
    pub first_year: f64,
    pub yearly: f64,
}

impl Warranty {
    /// The yield of each of `years` years from `energy`, a simulated year's with the modules new:
    /// each year's follows the warranted power's mean over it, linear between its ends, and never
    /// below nothing.
    #[must_use]
    pub fn yields(self, energy: f64, years: u16) -> Vec<f64> {
        let kept = |year: u16| {
            if year == 0 {
                return 1.0;
            }
            let later = f64::from(year - 1) * self.yearly;
            (1.0 - (self.first_year + later) / 100.0).max(0.0)
        };
        (1..=years)
            .map(|year| energy * f64::midpoint(kept(year - 1), kept(year)))
            .collect()
    }
}
