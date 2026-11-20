//! Forecasts as live issues leave them (ADR 15, 24).
//!
//! One issue a day of every passed target, and the targets ahead of the end as the last issue
//! leaves them. The solar forecast is computed
//! here from the same model and written in each series' stored step; the spot prices and the
//! weather go through the core's own devices, fed by the synthetic providers.

use jiff::tz::TimeZone;
use sunreye_core::bus::{Bus, DeviceId};
use sunreye_core::location::Location;
use sunreye_core::spot::{BiddingZone, SpotPrices};
use sunreye_core::storage::{Issue, Keep, Storage};
use sunreye_core::weather::Weather;

use crate::Error;
use crate::model::{Knot, Wiring, parallel};
use crate::plant::{STRING_COUNT, STRING_INVERTERS};
use crate::providers::{Clock, Forecasts, Prices, local_midnight};
use crate::series::Stored;
use crate::sky::Sky;

const HOUR: i64 = 3600;
/// A solar forecast covers today and two more days (ADR 17).
const HORIZON: i64 = 72 * HOUR;
/// A day's issue is made this long before the day begins.
const AHEAD: i64 = 3 * HOUR;
/// The day-ahead auction clears at 13:00 the day before.
const AUCTION: i64 = 11 * HOUR;
/// Days of weather forecasts the archive has not yet replaced at the end.
const UNSETTLED_DAYS: i64 = 4;

/// One PV series of an inverter, as the solar forecast stores it.
struct PvSeries<'a> {
    stored: &'a Stored,
    /// The inverter's place, and what the series sums: an input (0-based), a string, or all.
    inverter: usize,
    of: Of,
}

enum Of {
    Input(usize),
    String(usize),
    Inverter,
}

/// One issue's targets: their instants and the model under the forecast at each.
struct Issued {
    issued: i64,
    targets: Vec<(i64, Knot)>,
}

/// Writes the solar forecast of every PV series in `stored`: one issue a day from `from`, and one
/// at `to` over the horizon.
///
/// # Errors
/// Storage refused an issue.
pub async fn solar(
    storage: &Storage,
    (sky, wiring, zone): (Sky, &Wiring, &TimeZone),
    stored: &[Stored],
    strings: &[(u32, u32)],
    (from, to): (i64, i64),
) -> Result<usize, Error> {
    let series = pv_series(stored, strings);
    let mut written = 0;
    for issue in &modelled(sky, wiring, &issues(from, to, zone)) {
        for s in &series {
            let values = issue
                .targets
                .iter()
                .map(|(target, knot)| (crate::instant(*target), value(s, knot)))
                .collect();
            let forecast = Issue {
                issued: crate::instant(issue.issued),
                step: s.stored.policy.step,
                values,
                keep: Keep::Ahead,
            };
            storage
                .forecast(s.stored.device, s.stored.series, forecast)
                .await
                .map_err(|e| Error::Core(format!("{} forecast: {e}", s.stored.name)))?;
            written += issue.targets.len();
        }
    }
    Ok(written)
}

/// Each issue's instant and targets: one a day before each day from `from`, and one at `to` over
/// the horizon.
fn issues(from: i64, to: i64, zone: &TimeZone) -> Vec<(i64, Vec<i64>)> {
    let mut issues: Vec<(i64, Vec<i64>)> = days(from, to, zone)
        .into_iter()
        .map(|(start, end)| {
            let targets = (start..end.min(to)).step_by(900).collect();
            (start - AHEAD, targets)
        })
        .collect();
    let now = to.div_euclid(HOUR) * HOUR;
    issues.push((to, (now..now + HORIZON).step_by(900).collect()));
    issues
}

/// The model under each issue's forecast weather at each of its targets, on every core.
fn modelled(sky: Sky, wiring: &Wiring, issues: &[(i64, Vec<i64>)]) -> Vec<Issued> {
    let flat: Vec<(usize, i64, i64)> = issues
        .iter()
        .enumerate()
        .flat_map(|(i, (issued, targets))| targets.iter().map(move |t| (i, *issued, *t)))
        .collect();
    let knots = parallel(flat.len(), |k| {
        flat.get(k)
            .map_or_else(Knot::default, |&(_, issued, target)| {
                capped(
                    Knot::of(wiring, &sky.forecast(target, issued).weather()),
                    wiring,
                )
            })
    });
    let mut grouped: Vec<Issued> = issues
        .iter()
        .map(|(issued, _)| Issued {
            issued: *issued,
            targets: Vec::new(),
        })
        .collect();
    for (&(i, _, target), knot) in flat.iter().zip(knots) {
        if let Some(issue) = grouped.get_mut(i) {
            issue.targets.push((target, knot));
        }
    }
    grouped
}

/// Each inverter's model capped at its AC rating, its inputs and strings scaled with it, as the
/// solar forecast caps it (ADR 17).
fn capped(mut knot: Knot, wiring: &Wiring) -> Knot {
    for (place, (inputs, rating)) in knot.inputs.iter_mut().zip(wiring.ratings).enumerate() {
        let power: f64 = inputs.iter().map(|i| i.power).sum();
        if power <= rating {
            continue;
        }
        let kept = rating / power;
        for input in inputs.iter_mut() {
            input.power *= kept;
        }
        for (string, _) in knot
            .strings
            .iter_mut()
            .zip(STRING_INVERTERS)
            .filter(|(_, inverter)| *inverter == place)
        {
            *string *= kept;
        }
    }
    knot
}

fn value(series: &PvSeries<'_>, knot: &Knot) -> f64 {
    let inputs = knot.inputs.get(series.inverter);
    match series.of {
        Of::Input(i) => inputs
            .and_then(|inputs| inputs.get(i))
            .map_or(0.0, |i| i.power),
        Of::String(k) => knot.strings.get(k).copied().unwrap_or(0.0),
        Of::Inverter => inputs.map_or(0.0, |inputs| inputs.iter().map(|i| i.power).sum()),
    }
}

/// The PV series the solar forecast issues: each wired input's and inverter's, and each string's.
fn pv_series<'a>(stored: &'a [Stored], strings: &[(u32, u32)]) -> Vec<PvSeries<'a>> {
    let devices: Vec<DeviceId> = {
        let mut devices: Vec<DeviceId> = stored
            .iter()
            .filter(|s| s.name.starts_with("pv.string.power["))
            .map(|s| s.device)
            .collect();
        devices.dedup();
        devices
    };
    let mut series = Vec::new();
    for (inverter, device) in devices.iter().enumerate() {
        let wired: Vec<u32> = strings
            .iter()
            .zip(STRING_INVERTERS)
            .filter(|(_, i)| *i == inverter)
            .map(|(s, _)| s.1)
            .collect();
        for s in stored.iter().filter(|s| s.device == *device) {
            let of = if s.name == "pv.power" {
                Some(Of::Inverter)
            } else if let Some(input) = index(&s.name, "pv.mppt.power") {
                wired
                    .contains(&input)
                    .then(|| Of::Input(usize::try_from(input.saturating_sub(1)).unwrap_or(0)))
            } else {
                index(&s.name, "pv.string.power").and_then(|id| string(strings, id))
            };
            if let Some(of) = of {
                series.push(PvSeries {
                    stored: s,
                    inverter,
                    of,
                });
            }
        }
    }
    series
}

/// The string `id` by its place in the layout.
fn string(strings: &[(u32, u32)], id: u32) -> Option<Of> {
    let k = strings.iter().position(|s| s.0 == id)?;
    (k < STRING_COUNT).then_some(Of::String(k))
}

/// The index of `name` if it names `role` at one.
fn index(name: &str, role: &str) -> Option<u32> {
    name.strip_prefix(role)?
        .strip_prefix('[')?
        .strip_suffix(']')?
        .parse()
        .ok()
}

/// Spot prices issued each day at the auction for the next, and at `to`, through the core's
/// spot-price device.
///
/// # Errors
/// Storage failed.
pub async fn spot(
    storage: &Storage,
    (prices, zone, clock): (Prices, &TimeZone, &Clock),
    (from, to): (i64, i64),
    bus: &Bus,
) -> Result<(), Error> {
    let device = SpotPrices::new(prices, bus);
    let mut issues: Vec<i64> = days(from, to, zone)
        .into_iter()
        .map(|(start, _)| start - AUCTION)
        .collect();
    issues.push(to);
    for issued in issues {
        clock.set(issued);
        device
            .refresh(storage, BiddingZone::DeLu, crate::instant(issued))
            .await
            .map_err(|e| Error::Core(format!("spot prices: {e}")))?;
    }
    Ok(())
}

/// Weather forecasts of the days the archive has not replaced yet, issued at the start of each,
/// and at `to`, through the core's weather device.
///
/// # Errors
/// Storage failed.
pub async fn weather(
    storage: &Storage,
    (forecasts, zone, clock): (Forecasts, &TimeZone, &Clock),
    location: Location,
    to: i64,
    bus: &Bus,
) -> Result<(), Error> {
    let device = Weather::new(forecasts, sunreye_core::weather::DEVICE, bus);
    let mut issues: Vec<i64> = days(to - UNSETTLED_DAYS * 86_400, to, zone)
        .into_iter()
        .map(|(start, _)| start)
        .collect();
    issues.push(to);
    for issued in issues {
        clock.set(issued);
        device
            .refresh(storage, location, crate::instant(issued))
            .await
            .map_err(|e| Error::Core(format!("weather: {e}")))?;
    }
    Ok(())
}

/// The plant-local days from the one holding `from` to the one holding the last instant before
/// `to`, each by its start and end.
fn days(from: i64, to: i64, zone: &TimeZone) -> Vec<(i64, i64)> {
    let mut days = Vec::new();
    let mut start = local_midnight(from, zone);
    while start < to {
        let end = local_midnight(start + 30 * HOUR, zone);
        days.push((start, end));
        start = end;
    }
    days
}

#[cfg(test)]
mod tests {
    use super::days;

    #[test]
    fn a_plant_day_is_cut_in_its_zone_across_daylight_saving() {
        let zone = jiff::tz::TimeZone::get("Europe/Berlin").unwrap();
        // 2026-03-29, the spring change, has 23 hours.
        let start = 1_774_738_800;
        let cut = days(start, start + 86_400 * 2, &zone);
        assert_eq!(cut.first().map(|d| d.1 - d.0), Some(23 * 3600));
        assert_eq!(cut.get(1).map(|d| d.1 - d.0), Some(24 * 3600));
    }
}
