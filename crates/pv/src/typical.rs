//! A rounded location's typical year (ADR 17): for each calendar month, the past year's month closest to all
//! of them, by Sandia's Finkelstein–Schafer statistic, restamped into one year.

use crate::estimate::{SECONDS_PER_DAY, day_of_year, month};
use crate::{Location, Weather, clear_sky, sun_position};

/// The fewest past years a typical year is made from.
pub const FEWEST_YEARS: usize = 20;

/// The year a typical year is stamped in: it has no 29 February.
pub const TYPICAL_YEAR: i64 = 2001;

/// Weights of daily global irradiation, daily direct normal irradiation and daily mean
/// temperature.
const WEIGHTS: [f64; 3] = [0.5, 0.25, 0.25];

/// A typical year at its past years' step, and the past year each month, January first, comes
/// from.
#[derive(Debug, Clone, PartialEq)]
pub struct Typical {
    pub weather: Vec<Weather>,
    pub sources: [i64; 12],
}

/// Why no typical year is made.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TypicalRefused {
    /// Fewer than [`FEWEST_YEARS`], this many.
    TooFewYears(usize),
    /// The step does not divide a day.
    Step(i64),
    /// The past year at this position is not one whole UTC year at the step.
    NotWhole(usize),
}

impl std::fmt::Display for TypicalRefused {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::TooFewYears(n) => write!(f, "{n} past years, {FEWEST_YEARS} needed"),
            Self::Step(step) => write!(f, "a step of {step} s does not divide a day"),
            Self::NotWhole(i) => write!(f, "past year {i} is not one whole UTC year at the step"),
        }
    }
}

impl std::error::Error for TypicalRefused {}

/// One typical year from `years`, each a whole UTC year at `step` seconds, stamped as ADR 17 says.
///
/// Each month comes whole from the year whose daily sums and means are closest to all years',
/// restamped into [`TYPICAL_YEAR`]; 29 February is dropped.
///
/// # Errors
/// Fewer than [`FEWEST_YEARS`] years, a step that does not divide a day, or a year not whole.
pub fn typical_year(years: &[Vec<Weather>], step: i64) -> Result<Typical, TypicalRefused> {
    if years.len() < FEWEST_YEARS {
        return Err(TypicalRefused::TooFewYears(years.len()));
    }
    if step <= 0 || SECONDS_PER_DAY % step != 0 {
        return Err(TypicalRefused::Step(step));
    }
    let numbers = years
        .iter()
        .enumerate()
        .map(|(i, samples)| whole_year(samples, step).ok_or(TypicalRefused::NotWhole(i)))
        .collect::<Result<Vec<_>, _>>()?;
    let mut sources = [0; 12];
    let mut weather = Vec::new();
    for (m, source) in sources.iter_mut().enumerate() {
        // Each year's days of the month, as [global, direct normal, temperature] per day.
        let days: Vec<Vec<[f64; 3]>> = years.iter().map(|y| daily(y, m, step)).collect();
        let best = closest(&days);
        let Some((&year, samples)) = numbers.iter().zip(years).nth(best) else {
            continue;
        };
        *source = year;
        let shift = (month_start(TYPICAL_YEAR, m) - month_start(year, m)) * SECONDS_PER_DAY;
        weather.extend(
            samples
                .iter()
                .filter(|w| month_of(w.unix) == m && !leap_day(w.unix))
                .map(|w| Weather {
                    unix: w.unix + shift,
                    ..*w
                }),
        );
    }
    Ok(Typical { weather, sources })
}

/// Each hourly mean of `hourly`, stamped at its hour's middle, as four quarter hours stamped at
/// theirs (ADR 17).
///
/// Global, direct normal and diffuse irradiance each follow their clear-sky shape over `location`
/// across the hour, and the four quarters' mean is the hour's, so the hour's energy is kept. An
/// hour whose clear sky is dark throughout is spread evenly. Temperature and wind are held.
#[must_use]
pub fn quarter_hours(hourly: &[Weather], location: Location) -> Vec<Weather> {
    let mut quarters = Vec::with_capacity(hourly.len() * 4);
    for hour in hourly {
        let stamps = [-1350, -450, 450, 1350].map(|offset| hour.unix + offset);
        let clear = stamps.map(|unix| {
            let sky = clear_sky(
                sun_position(unix, location),
                day_of_year(unix.div_euclid(SECONDS_PER_DAY)),
            );
            [sky.ghi.max(0.0), sky.dni.max(0.0), sky.dhi.max(0.0)]
        });
        let means = [hour.ghi, hour.dni, hour.dhi];
        let shares: [[f64; 4]; 3] = std::array::from_fn(|k| {
            let shape = clear.map(|c| c.get(k).copied().unwrap_or(0.0));
            let sum: f64 = shape.iter().sum();
            let mean = means.get(k).copied().unwrap_or(0.0);
            if sum > 0.0 {
                shape.map(|c| 4.0 * mean * c / sum)
            } else {
                [mean; 4]
            }
        });
        let [ghi, dni, dhi] = shares;
        for (q, unix) in stamps.into_iter().enumerate() {
            let at = |of: &[f64; 4]| of.get(q).copied().unwrap_or(0.0);
            quarters.push(Weather {
                unix,
                ghi: at(&ghi),
                dni: at(&dni),
                dhi: at(&dhi),
                ..*hour
            });
        }
    }
    quarters
}

/// The UTC year `samples` cover whole at `step`, in order.
fn whole_year(samples: &[Weather], step: i64) -> Option<i64> {
    let first = samples.first()?.unix;
    let year = year_of(first.div_euclid(SECONDS_PER_DAY));
    let start = days_from_civil(year, 1, 1) * SECONDS_PER_DAY;
    let end = days_from_civil(year + 1, 1, 1) * SECONDS_PER_DAY;
    let offset = first - start;
    let count = usize::try_from((end - start) / step).ok()?;
    let contiguous = samples
        .iter()
        .zip(0..)
        .all(|(w, i)| w.unix == first + i * step);
    (offset < step && samples.len() == count && contiguous).then_some(year)
}

/// Each UTC day's global and direct normal irradiation and mean temperature of month `m`.
fn daily(samples: &[Weather], m: usize, step: i64) -> Vec<[f64; 3]> {
    #[expect(
        clippy::cast_precision_loss,
        reason = "a step is seconds, far below 2^52"
    )]
    let hours = step as f64 / 3600.0;
    let mut days: Vec<(i64, [f64; 3], f64)> = Vec::new();
    for w in samples.iter().filter(|w| month_of(w.unix) == m) {
        let day = w.unix.div_euclid(SECONDS_PER_DAY);
        if days.last().is_none_or(|(d, _, _)| *d != day) {
            days.push((day, [0.0; 3], 0.0));
        }
        if let Some((_, sums, count)) = days.last_mut() {
            sums[0] += w.ghi;
            sums[1] += w.dni;
            sums[2] += w.temperature;
            *count += 1.0;
        }
    }
    days.into_iter()
        .map(|(_, [ghi, dni, temperature], count)| [ghi * hours, dni * hours, temperature / count])
        .collect()
}

/// The position of the year whose days are closest to all years' by the weighted
/// Finkelstein–Schafer statistic; the earlier on a tie.
fn closest(days: &[Vec<[f64; 3]>]) -> usize {
    let mut score = vec![0.0; days.len()];
    for (k, weight) in WEIGHTS.iter().enumerate() {
        let value = |day: &[f64; 3]| day.get(k).copied().unwrap_or(0.0);
        let mut all: Vec<f64> = days.iter().flatten().map(value).collect();
        all.sort_by(f64::total_cmp);
        for (s, year) in score.iter_mut().zip(days) {
            let mut own: Vec<f64> = year.iter().map(value).collect();
            own.sort_by(f64::total_cmp);
            *s += weight * statistic(&own, &all);
        }
    }
    score
        .iter()
        .enumerate()
        .min_by(|(_, a), (_, b)| a.total_cmp(b))
        .map_or(0, |(i, _)| i)
}

/// The mean distance between a year's distribution, `own`, and the long term's, `all`, at each
/// day of the long term; both sorted. Both are taken by value, so days alike count as one value,
/// and taken at every day of all years, so a year above the middle scores as one as far below.
#[expect(clippy::cast_precision_loss, reason = "counts of days, far below 2^52")]
fn statistic(own: &[f64], all: &[f64]) -> f64 {
    let n = own.len() as f64;
    let total = all.len() as f64;
    all.iter()
        .map(|&x| {
            let ours = own.partition_point(|&v| v <= x) as f64 / n;
            let theirs = all.partition_point(|&v| v <= x) as f64 / total;
            (ours - theirs).abs()
        })
        .sum::<f64>()
        / total
}

fn month_of(unix: i64) -> usize {
    month(unix.div_euclid(SECONDS_PER_DAY))
}

fn leap_day(unix: i64) -> bool {
    let day = unix.div_euclid(SECONDS_PER_DAY);
    let year = year_of(day);
    month(day) == 1 && day - days_from_civil(year, 2, 1) == 28
}

/// Days from 1970 to the first of month `m`, 0 for January, of `year`.
fn month_start(year: i64, m: usize) -> i64 {
    days_from_civil(year, i64::try_from(m).unwrap_or(0) + 1, 1)
}

/// The UTC year of the day `days` after 1970-01-01 (Hinnant's civil-from-days).
fn year_of(days: i64) -> i64 {
    let shifted = days + 719_468;
    let era = shifted.div_euclid(146_097);
    let of_era = shifted - era * 146_097;
    let year_of_era = (of_era - of_era / 1460 + of_era / 36_524 - of_era / 146_096) / 365;
    let of_year = of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    year_of_era + era * 400 + i64::from(of_year >= 306)
}

/// Days from 1970-01-01 to a date (Hinnant's days-from-civil).
const fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let (y, m) = if month <= 2 {
        (year - 1, month + 9)
    } else {
        (year, month - 3)
    };
    let era = y.div_euclid(400);
    let of_era = y - era * 400;
    let of_year = (153 * m + 2) / 5 + day - 1;
    era * 146_097 + of_era * 365 + of_era / 4 - of_era / 100 + of_year - 719_468
}
