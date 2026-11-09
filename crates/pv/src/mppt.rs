//! Strings in parallel on one MPPT input, within the input's limits.

use crate::string::{Curve, peak};
use crate::{Input, InputEstimate, MpptLimits, Occluder, PvString, Sky};

/// The input's operating point: the peak of its strings' summed currents at a shared voltage,
/// within its voltage window and current limit. Without limits (ADR 5) nothing is capped.
#[must_use]
pub fn input_output(input: &Input, sky: &Sky, occluders: &[Occluder]) -> InputEstimate {
    let curves: Vec<Curve> = input
        .strings
        .iter()
        .map(|s| Curve::new(s, sky, occluders))
        .collect();
    let nothing = InputEstimate {
        current: 0.0,
        voltage: 0.0,
        power: 0.0,
        strings: vec![0.0; curves.len()],
    };
    if curves.iter().all(|c| c.top <= 0.0) {
        return nothing;
    }
    let current = |v: f64| curves.iter().map(|c| c.current(v)).sum::<f64>();
    let open_circuit = curves.iter().map(|c| c.voltage(0.0)).fold(0.0, f64::max);
    let Some((low, high, cap)) = window(input.limits, open_circuit, &current) else {
        return nothing;
    };
    let power = |v: f64| v * current(v).min(cap);
    // Each curve's own samples place the candidates where its knees are.
    let mut candidates: Vec<f64> = curves.iter().flat_map(Curve::voltages).collect();
    candidates.extend([low, high]);
    candidates.retain(|v| v.is_finite());
    candidates.sort_by(f64::total_cmp);
    let voltage = peak(&candidates, &power, |v| v >= low && v <= high);
    let total = current(voltage);
    let flowing = total.min(cap);
    InputEstimate {
        current: flowing,
        voltage,
        power: voltage * flowing,
        strings: curves
            .iter()
            .map(|c| {
                if total > 0.0 {
                    voltage * flowing * c.current(voltage) / total
                } else {
                    0.0
                }
            })
            .collect(),
    }
}

/// The voltages the input may run at and its current limit; `None` when its strings cannot
/// reach its window or its start voltage.
fn window(
    limits: Option<MpptLimits>,
    open_circuit: f64,
    current: &impl Fn(f64) -> f64,
) -> Option<(f64, f64, f64)> {
    let Some(limits) = limits else {
        return Some((0.0, open_circuit, f64::INFINITY));
    };
    if open_circuit < limits.min_voltage.max(limits.start_voltage) {
        return None;
    }
    let high = limits.max_voltage.min(open_circuit);
    let low = if current(limits.min_voltage) > limits.max_current {
        voltage_at(current, limits.max_current, limits.min_voltage, high)
    } else {
        limits.min_voltage
    };
    Some((low.min(high), high, limits.max_current))
}

/// The voltage in `[low, high]` where the falling `current` meets `target`.
fn voltage_at(current: &impl Fn(f64) -> f64, target: f64, mut low: f64, mut high: f64) -> f64 {
    for _ in 0..100 {
        let middle = f64::midpoint(low, high);
        if current(middle) > target {
            low = middle;
        } else {
            high = middle;
        }
    }
    f64::midpoint(low, high)
}

/// The lint for one input's strings: parallel strings of different lengths
/// force each other off their maximum power point.
#[must_use]
pub fn module_counts_differ(strings: &[PvString]) -> bool {
    strings.windows(2).any(|pair| match pair {
        [a, b] => a.modules.len() != b.modules.len(),
        _ => false,
    })
}
