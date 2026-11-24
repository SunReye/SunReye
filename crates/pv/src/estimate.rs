//! A layout's output under one weather instant: strings, then their MPPT inputs, then inverters.

use crate::mppt::tallied_point;
use crate::shade::Casters;
use crate::string::{Open, Shade, Tally};
use crate::{Estimate, InverterEstimate, Layout, Sky, SkyViews, Weather, sun_position};

pub const SECONDS_PER_DAY: i64 = 86_400;

#[must_use]
pub fn estimate(layout: &Layout, weather: &Weather) -> Estimate {
    let sky = sky(layout, weather);
    let casters = Casters::under(sky.sun, &layout.occluders);
    shaded(layout, &sky, |_| (Shade::Traced(&casters), Open::SKY))
}

/// The same under the horizon profile the caller supplies, laid over `layout` once (ADR 17).
#[must_use]
pub fn estimate_with(layout: &Layout, views: &SkyViews, weather: &Weather) -> Estimate {
    let sky = sky(layout, weather);
    let casters = Casters::under(sky.sun, &layout.occluders);
    shaded(layout, &sky, |string| {
        (Shade::Traced(&casters), views.open(sky.sun, string))
    })
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

/// The estimate with each string's shade and what a horizon leaves it, by its place in the
/// layout's order, from `shade`.
pub fn shaded<'a>(
    layout: &Layout,
    sky: &Sky,
    shade: impl Fn(usize) -> (Shade<'a>, Open<'a>),
) -> Estimate {
    tallied(layout, sky, shade, None)
}

/// Each string's stages of the loss chain, in layout order, and each input's watts free of its
/// limits, in layout order: what a year's run adds up besides the estimate.
#[derive(Debug, Default)]
pub struct Tallies {
    pub strings: Vec<Tally>,
    pub free: Vec<f64>,
}

/// The same, tallying into `tallies`, if any, which it clears first.
pub fn tallied<'a>(
    layout: &Layout,
    sky: &Sky,
    shade: impl Fn(usize) -> (Shade<'a>, Open<'a>),
    mut tallies: Option<&mut Tallies>,
) -> Estimate {
    if let Some(tallies) = tallies.as_deref_mut() {
        tallies.strings.clear();
        tallies.free.clear();
    }
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
                    let shade = |k| shade(from + k);
                    let Some(tallies) = tallies.as_deref_mut() else {
                        return tallied_point(input, sky, shade, None).0;
                    };
                    let mut strings = vec![Tally::default(); input.strings.len()];
                    let (estimate, free) = tallied_point(input, sky, shade, Some(&mut strings));
                    tallies.strings.extend(strings);
                    tallies.free.push(free);
                    estimate
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
