//! A layout's output under one weather instant: strings, then their MPPT inputs, then inverters.

use crate::{
    Estimate, Input, InputEstimate, InverterEstimate, Layout, Sky, StringOutput, Weather,
    inverter_power, mppt_output, string_output, sun_position,
};

const SECONDS_PER_DAY: i64 = 86_400;

#[must_use]
pub fn estimate(layout: &Layout, weather: &Weather) -> Estimate {
    let sky = Sky {
        sun: sun_position(weather.unix, layout.location),
        day_of_year: day_of_year(weather.unix.div_euclid(SECONDS_PER_DAY)),
        ghi: weather.ghi,
        dni: weather.dni,
        dhi: weather.dhi,
        temperature: weather.temperature,
        wind: weather.wind,
    };
    let inverters = layout
        .inverters
        .iter()
        .map(|inverter| {
            let inputs: Vec<InputEstimate> =
                inverter.inputs.iter().map(|i| input(i, &sky)).collect();
            let outputs: Vec<_> = inputs
                .iter()
                .map(|i| StringOutput {
                    current: i.current,
                    voltage: i.voltage,
                    power: i.power,
                })
                .collect();
            InverterEstimate {
                power: inverter_power(&outputs, inverter.ac_rating.unwrap_or(f64::INFINITY)),
                inputs,
            }
        })
        .collect();
    Estimate { inverters }
}

/// The input's operating point; each string gets the share of its modelled current (ADR 17).
fn input(input: &Input, sky: &Sky) -> InputEstimate {
    let strings: Vec<_> = input
        .strings
        .iter()
        .map(|s| string_output(s, sky))
        .collect();
    let output = mppt_output(&strings, input.limits.as_ref());
    let current: f64 = strings.iter().map(|s| s.current).sum();
    let shares = strings
        .iter()
        .map(|s| {
            if current > 0.0 {
                output.power * s.current / current
            } else {
                0.0
            }
        })
        .collect();
    InputEstimate {
        current: output.current,
        voltage: output.voltage,
        power: output.power,
        strings: shares,
    }
}

/// 1 to 366, for the UTC day `days` after 1970-01-01 (Hinnant's civil-from-days).
fn day_of_year(days: i64) -> u16 {
    let shifted = days + 719_468;
    let era = shifted.div_euclid(146_097);
    let of_era = shifted - era * 146_097;
    let year_of_era = (of_era - of_era / 1460 + of_era / 36_524 - of_era / 146_096) / 365;
    // Days since 1 March.
    let of_year = of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let year = year_of_era + era * 400 + i64::from(of_year >= 306);
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let since_january = if of_year >= 306 {
        of_year - 306
    } else {
        of_year + 59 + i64::from(leap)
    };
    u16::try_from(since_january + 1).unwrap_or(1)
}
