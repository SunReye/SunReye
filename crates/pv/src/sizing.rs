//! MPPT window warnings (ADR 20): where a layout leaves an MPPT input's limits at −10 °C or at a
//! 70 °C cell. They warn and never refuse: the plant may already exist.

use std::collections::BTreeMap;

use crate::{COLD, ModuleType, MpptLimits, open_circuit_voltage};

/// The cell temperature in °C a string's lowest maximum-power voltage is reckoned at.
pub const HOT: f64 = 70.0;

/// A string as sizing reads it: its inverter by device, its MPPT input from 1, and its modules.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Wired {
    pub device: u32,
    pub input: u32,
    pub module: ModuleType,
    pub modules: u16,
}

/// Where a layout leaves an MPPT input's limits; a string by its position in the layout.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Sizing {
    /// Its open-circuit voltage at −10 °C stays below the input's start voltage.
    Start {
        string: usize,
        volts: f64,
        limit: f64,
    },
    /// Its maximum-power voltage at a 70 °C cell lies below the input's window.
    Low {
        string: usize,
        volts: f64,
        limit: f64,
    },
    /// Its maximum-power voltage at −10 °C lies above the input's window.
    High {
        string: usize,
        volts: f64,
        limit: f64,
    },
    /// The input's parallel strings' short-circuit currents sum over its maximum input current.
    Current {
        device: u32,
        input: u32,
        amperes: f64,
        limit: f64,
    },
    /// The input's parallel strings differ in module count (ADR 17).
    Uneven { device: u32, input: u32 },
    /// The string names an input its inverter does not have.
    NoInput { string: usize },
}

/// A string's maximum-power voltage at a cell temperature in °C, by the datasheet's voltage
/// coefficient, as its open-circuit voltage scales.
fn peak_voltage(module: &ModuleType, modules: u16, temperature: f64) -> f64 {
    let per_module =
        module.vmp * (module.voltage_coefficient / 100.0).mul_add(temperature - 25.0, 1.0);
    per_module * f64::from(modules)
}

/// How string `string` leaves the window of its input.
fn window(string: usize, wired: &Wired, limits: &MpptLimits) -> Vec<Sizing> {
    let Wired {
        module, modules, ..
    } = wired;
    let open = open_circuit_voltage(module, *modules, COLD);
    let start = (open < limits.start_voltage).then_some(Sizing::Start {
        string,
        volts: open,
        limit: limits.start_voltage,
    });
    let hot = peak_voltage(module, *modules, HOT);
    let low = (hot < limits.min_voltage).then_some(Sizing::Low {
        string,
        volts: hot,
        limit: limits.min_voltage,
    });
    let cold = peak_voltage(module, *modules, COLD);
    let high = (cold > limits.max_voltage).then_some(Sizing::High {
        string,
        volts: cold,
        limit: limits.max_voltage,
    });
    [start, low, high].into_iter().flatten().collect()
}

/// What the strings in parallel on one input do to it together.
fn shared(device: u32, input: u32, strings: &[&Wired], limits: &MpptLimits) -> Vec<Sizing> {
    let amperes: f64 = strings.iter().map(|wired| wired.module.isc).sum();
    let current = (amperes > limits.max_current).then_some(Sizing::Current {
        device,
        input,
        amperes,
        limit: limits.max_current,
    });
    let uneven = strings
        .windows(2)
        .any(|pair| matches!(pair, [a, b] if a.modules != b.modules))
        .then_some(Sizing::Uneven { device, input });
    [current, uneven].into_iter().flatten().collect()
}

/// Every MPPT window warning of `strings`.
///
/// Each string's own come first in the layout's order, then each input's by device and input.
/// `inverters` holds each inverter's inputs' limits in the inputs' order; a string on an inverter
/// without them, or with no module yet, warns nothing.
#[must_use]
pub fn window_warnings(
    strings: &[Wired],
    inverters: &BTreeMap<u32, Vec<MpptLimits>>,
) -> Vec<Sizing> {
    // None without the inverter's limits; else the input's, none where it has no such input.
    let limits = |device: u32, input: u32| {
        let inputs = inverters.get(&device)?;
        // Inputs count from 1: input 0 is none of them.
        let at = usize::try_from(input).ok().and_then(|at| at.checked_sub(1));
        Some(at.and_then(|at| inputs.get(at)))
    };
    let own = strings.iter().enumerate().flat_map(|(string, wired)| {
        match limits(wired.device, wired.input) {
            None => Vec::new(),
            Some(None) => vec![Sizing::NoInput { string }],
            Some(Some(_)) if wired.modules == 0 => Vec::new(),
            Some(Some(found)) => window(string, wired, found),
        }
    });
    let mut inputs: BTreeMap<(u32, u32), Vec<&Wired>> = BTreeMap::new();
    for wired in strings.iter().filter(|wired| wired.modules > 0) {
        let on = inputs.entry((wired.device, wired.input)).or_default();
        on.push(wired);
    }
    let together = inputs.iter().flat_map(|((device, input), on)| {
        limits(*device, *input)
            .flatten()
            .map_or_else(Vec::new, |found| shared(*device, *input, on, found))
    });
    own.chain(together).collect()
}

/// The most modules of `module` in series that auto-stringing wires (ADR 20).
///
/// Its open-circuit voltage at −10 °C stays within the inverter's maximum DC input voltage and its
/// maximum-power voltage there within the input's window. None without either limit.
#[must_use]
pub fn longest_string(
    module: &ModuleType,
    max_input_voltage: Option<f64>,
    limits: Option<&MpptLimits>,
) -> Option<u16> {
    let open = max_input_voltage.map(|limit| limit / open_circuit_voltage(module, 1, COLD));
    let peak = limits.map(|limits| limits.max_voltage / peak_voltage(module, 1, COLD));
    let most = match (open, peak) {
        (Some(open), Some(peak)) => open.min(peak),
        (one, other) => one.or(other)?,
    };
    // The same rounding the warnings compare with: a string at the limit is not over it.
    let whole = most.floor().clamp(0.0, f64::from(u16::MAX));
    #[expect(
        clippy::cast_possible_truncation,
        clippy::cast_sign_loss,
        reason = "clamped to u16's range just above"
    )]
    Some(whole as u16)
}
