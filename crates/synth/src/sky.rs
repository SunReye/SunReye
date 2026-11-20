//! The synthetic sky over the plant.
//!
//! The clear-sky model dimmed by clouds drawn per day, with seasons. Every value is a pure function of the seed and the instant, so the measured weather,
//! the forecasts and the archive agree.

use sunreye_core::weather::{Detail, Slot};
use sunreye_pv as pv;

use crate::noise::{Noise, Stream};

const DAY: i64 = 86_400;
const DAY_KIND: Stream = Stream(1);
const DAY_DEPTH: Stream = Stream(2);
const DRIFT: Stream = Stream(3);
const FLICKER: Stream = Stream(4);
const WARMTH: Stream = Stream(5);
const WIND: Stream = Stream(6);
const FORECAST: Stream = Stream(7);
const FORECAST_WARMTH: Stream = Stream(8);
const RAIN: Stream = Stream(9);

/// Model runs come every three hours, as ICON-D2's: a forecast changes only with a new run.
const RUN: i64 = 3 * 3600;

/// The weather at one instant.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Air {
    pub unix: i64,
    /// The fraction of the clear sky's global irradiance that reaches the ground.
    pub clearness: f64,
    pub ghi: f64,
    pub dni: f64,
    pub dhi: f64,
    /// °C.
    pub temperature: f64,
    /// m/s.
    pub wind: f64,
}

impl Air {
    /// As the `pv` model reads it.
    #[must_use]
    pub const fn weather(&self) -> pv::Weather {
        pv::Weather {
            unix: self.unix,
            ghi: self.ghi,
            dni: self.dni,
            dhi: self.dhi,
            temperature: self.temperature,
            wind: Some(self.wind),
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct Sky {
    noise: Noise,
    location: pv::Location,
}

impl Sky {
    #[must_use]
    pub const fn new(seed: u64, location: pv::Location) -> Self {
        Self {
            noise: Noise::new(seed),
            location,
        }
    }

    /// Where the sky is.
    #[must_use]
    pub const fn location(&self) -> pv::Location {
        self.location
    }

    /// The weather at `unix`, to the second.
    #[must_use]
    pub fn at(&self, unix: i64) -> Air {
        let clearness = self.clearness(unix);
        self.air(unix, clearness, self.temperature(unix))
    }

    /// The forecast for `target` of the model run current at `issued`: the measured weather off
    /// by an error that grows with the lead time.
    #[must_use]
    pub fn forecast(&self, target: i64, issued: i64) -> Air {
        let run = issued.div_euclid(RUN) * RUN;
        #[expect(clippy::cast_precision_loss, reason = "hours of lead")]
        let lead = ((target - run).max(0) / 3600) as f64;
        let spread = (lead / 48.0).min(1.0);
        let position = target.wrapping_mul(31).wrapping_add(run);
        let error = self.noise.normal(FORECAST, position) * spread.mul_add(0.18, 0.04);
        let clearness = (self.clearness(target) + error).clamp(0.03, 1.0);
        let warmth = self.noise.normal(FORECAST_WARMTH, position) * spread.mul_add(2.0, 0.4);
        self.air(target, clearness, self.temperature(target) + warmth)
    }

    /// A weather slot as a provider answers it, with the detail ADR 23 stores.
    #[must_use]
    #[expect(clippy::too_many_lines, reason = "one field per quantity")]
    pub fn slot(&self, air: Air) -> Slot {
        let hour = air.unix.rem_euclid(3600) == 0;
        let rain = if air.clearness < 0.35 {
            (self.noise.smooth(RAIN, air.unix, 3600) * 2.0).max(0.0)
        } else {
            0.0
        };
        let snow = air.temperature < 1.0;
        let code = match (air.clearness, rain > 0.0, snow) {
            (_, true, true) => 71.0,
            (_, true, false) => 61.0,
            (k, false, _) if k >= 0.8 => 0.0,
            (k, false, _) if k >= 0.5 => 2.0,
            _ => 3.0,
        };
        let cloud_cover = ((1.0 - air.clearness) * 100.0).round();
        let sun = pv::sun_position(air.unix, self.location);
        let sunshine = if sun.zenith < 90.0 {
            (3600.0 * ((air.clearness - 0.4) / 0.5).clamp(0.0, 1.0)).round()
        } else {
            0.0
        };
        Slot {
            target: crate::instant(air.unix),
            ghi: air.ghi,
            dni: air.dni,
            dhi: air.dhi,
            temperature: air.temperature,
            wind: Some(air.wind),
            detail: Detail {
                code: Some(code),
                precipitation: Some(rain),
                snowfall: Some(if snow { rain * 0.7 } else { 0.0 }),
                visibility: Some(air.clearness.mul_add(20_000.0, 2_000.0).round()),
                humidity: Some((1.0 - air.clearness).mul_add(35.0, 55.0)),
                wind_direction: Some(
                    self.noise
                        .smooth(WIND, air.unix + 7, 6 * 3600)
                        .mul_add(80.0, 240.0)
                        .rem_euclid(360.0),
                ),
                gusts: Some(air.wind * 1.7),
                apparent_temperature: Some(air.wind.mul_add(-0.7, air.temperature)),
                sunshine: hour.then_some(sunshine),
                cloud_cover: hour.then_some(cloud_cover),
                snow_depth: hour.then_some(
                    if self.day_temperature(air.unix.div_euclid(DAY)) < -2.0 {
                        0.04
                    } else {
                        0.0
                    },
                ),
            },
        }
    }

    /// The sky's clearness at `unix`: the day's kind, a drift over quarter hours and, on mixed
    /// days, clouds passing within minutes.
    #[must_use]
    pub fn clearness(&self, unix: i64) -> f64 {
        let (mean, variable) = self.day(unix.div_euclid(DAY));
        let drift = self.noise.smooth(DRIFT, unix, 900) * variable;
        let flicker = self.noise.smooth(FLICKER, unix, 40) * variable * 1.4;
        (mean + drift + flicker).clamp(0.03, 1.0)
    }

    /// The clearness of a UTC day and how much it varies: clear days are likelier in summer.
    fn day(&self, day: i64) -> (f64, f64) {
        let summer = summer(day * DAY);
        let draw = self.noise.unit(DAY_KIND, day);
        let depth = self.noise.unit(DAY_DEPTH, day);
        let clear = summer.mul_add(0.2, 0.2);
        let overcast = summer.mul_add(-0.2, 0.45);
        if draw < clear {
            (depth.mul_add(0.08, 0.9), 0.03)
        } else if draw < clear + overcast {
            (depth.mul_add(0.25, 0.1), 0.05)
        } else {
            (depth.mul_add(0.3, 0.45), 0.2)
        }
    }

    /// °C: the season, the day's own warmth and the afternoon's.
    fn temperature(&self, unix: i64) -> f64 {
        let day = unix.div_euclid(DAY);
        let (clearness, _) = self.day(day);
        #[expect(clippy::cast_precision_loss, reason = "seconds of a day")]
        let hour = unix.rem_euclid(DAY) as f64 / 3600.0;
        let swing = clearness.mul_add(5.0, 2.0);
        let afternoon = ((hour - 8.0) / 24.0 * std::f64::consts::TAU).sin();
        swing.mul_add(afternoon, self.day_temperature(day))
    }

    /// A day's mean temperature: the season and a warm or cold spell drifting over days.
    fn day_temperature(&self, day: i64) -> f64 {
        let season = summer(day * DAY).mul_add(19.0, -0.5);
        let spell = self.noise.smooth(WARMTH, day, 4) * 5.0;
        season + spell
    }

    fn air(&self, unix: i64, clearness: f64, temperature: f64) -> Air {
        let sun = pv::sun_position(unix, self.location);
        let day = unix.div_euclid(DAY);
        let clear = pv::clear_sky(sun, pv_day_of_year(day));
        let ghi = clear.ghi * clearness;
        let dni = clear.dni * clearness.powf(1.8);
        let cos_zenith = sun.zenith.to_radians().cos().max(0.0);
        let dhi = dni.mul_add(-cos_zenith, ghi).max(0.0);
        let wind = self
            .noise
            .smooth(WIND, unix, 3 * 3600)
            .mul_add(2.0, 3.5)
            .max(0.2);
        Air {
            unix,
            clearness,
            ghi,
            dni,
            dhi,
            temperature,
            wind,
        }
    }
}

/// 0 in midwinter to 1 in midsummer, by the day of the year of `unix`.
fn summer(unix: i64) -> f64 {
    let day = f64::from(pv_day_of_year(unix.div_euclid(DAY)));
    (1.0 - ((day + 10.0) / 365.25 * std::f64::consts::TAU).cos()) / 2.0
}

/// 1 to 366 for the UTC day `days` after 1970-01-01.
fn pv_day_of_year(days: i64) -> u16 {
    let date = jiff::Timestamp::from_second(days * DAY)
        .map(|t| t.to_zoned(jiff::tz::TimeZone::UTC).date())
        .unwrap_or_default();
    u16::try_from(date.day_of_year()).unwrap_or(1)
}
