//! A layout's output under one weather instant: strings, then their MPPT inputs, then inverters.

use crate::mppt::operating_point;
use crate::shade::Casters;
use crate::string::Shade;
use crate::{Estimate, InverterEstimate, Layout, Sky, Weather, sun_position};

pub const SECONDS_PER_DAY: i64 = 86_400;

#[must_use]
pub fn estimate(layout: &Layout, weather: &Weather) -> Estimate {
    let sky = sky(layout, weather);
    let casters = Casters::under(sky.sun, &layout.occluders);
    shaded(layout, &sky, |_| Shade::Traced(&casters))
}

/// The weather at the layout's location.
pub fn sky(layout: &Layout, weather: &Weather) -> Sky {
    Sky {
        sun: sun_position(weather.unix, layout.location),
        day_of_year: day_of_year(weather.unix.div_euclid(SECONDS_PER_DAY)),
        ghi: weather.ghi,
        dni: weather.dni,
        dhi: weather.dhi,
        temperature: weather.temperature,
        wind: weather.wind,
    }
}

/// The estimate with each string's shade, by its place in the layout's order, from `shade`.
pub fn shaded<'a>(layout: &Layout, sky: &Sky, shade: impl Fn(usize) -> Shade<'a>) -> Estimate {
    let mut first = 0;
    let inverters = layout
        .inverters
        .iter()
        .map(|inverter| {
            let inputs: Vec<_> = inverter
                .inputs
                .iter()
                .map(|input| {
                    let from = first;
                    first += input.strings.len();
                    operating_point(input, sky, |k| shade(from + k))
                })
                .collect();
            InverterEstimate {
                power: inputs.iter().map(|i| i.power).sum(),
                inputs,
            }
        })
        .collect();
    Estimate { inverters }
}

/// 0 for January to 11 for December, for the UTC day `days` after 1970-01-01 (Hinnant's
/// civil-from-days).
pub fn month(days: i64) -> usize {
    let shifted = days + 719_468;
    let of_era = shifted - shifted.div_euclid(146_097) * 146_097;
    let year_of_era = (of_era - of_era / 1460 + of_era / 36_524 - of_era / 146_096) / 365;
    let of_year = of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    // From March, 0.
    let from_march = (5 * of_year + 2) / 153;
    usize::try_from((from_march + 2) % 12).unwrap_or(0)
}

/// 1 to 366, for the UTC day `days` after 1970-01-01 (Hinnant's civil-from-days).
pub fn day_of_year(days: i64) -> u16 {
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
