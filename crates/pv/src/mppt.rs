//! Strings in parallel on one MPPT input, within the input's limits.

use crate::{MpptLimits, PvString, StringOutput};

const NOTHING: StringOutput = StringOutput {
    current: 0.0,
    voltage: 0.0,
    power: 0.0,
};

/// The input's operating point. Without limits (ADR 5) nothing is capped.
#[must_use]
pub fn mppt_output(strings: &[StringOutput], limits: Option<&MpptLimits>) -> StringOutput {
    let current: f64 = strings.iter().map(|s| s.current).sum();
    let power: f64 = strings.iter().map(|s| s.power).sum();
    if current <= 0.0 {
        return NOTHING;
    }
    // Parallel strings share one voltage.
    let voltage = power / current;
    let Some(limits) = limits else {
        return StringOutput {
            current,
            voltage,
            power,
        };
    };
    if voltage < limits.min_voltage.max(limits.start_voltage) {
        return NOTHING;
    }
    // Without a current-voltage curve the current at the clipped voltage stays the string's.
    let voltage = voltage.min(limits.max_voltage);
    let current = current.min(limits.max_current);
    StringOutput {
        current,
        voltage,
        power: voltage * current,
    }
}

/// The lint for one input's strings: parallel strings of different lengths
/// force each other off their maximum power point.
#[must_use]
pub fn module_counts_differ(strings: &[PvString]) -> bool {
    strings.windows(2).any(|pair| match pair {
        [a, b] => a.modules != b.modules,
        _ => false,
    })
}
