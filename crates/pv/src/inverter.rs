//! An inverter's output from its MPPT inputs.

use crate::StringOutput;

/// The inputs' power capped at the AC rating, in watts.
#[must_use]
pub fn inverter_power(inputs: &[StringOutput], ac_rating: f64) -> f64 {
    inputs.iter().map(|i| i.power).sum::<f64>().min(ac_rating)
}
