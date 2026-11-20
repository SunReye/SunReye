//! The providers the core's weather, archive and spot-price modules fetch from, answering from
//! the synthetic sky and market at the simulated now, with no network.

use std::future::Future;
use std::sync::Arc;
use std::sync::atomic::{AtomicI64, Ordering};

use jiff::tz::TimeZone;
use sunreye_core::location::Location;
use sunreye_core::spot::{self, BiddingZone};
use sunreye_core::weather::{self, Slot};

use crate::noise::{Noise, Stream};
use crate::sky::Sky;

const HOUR: i64 = 3600;
const QUARTER: i64 = 900;
/// The weather forecast covers today and two more days at 15 minutes (ADR 17).
const FORECAST_DAYS: i64 = 3;
/// The day-ahead auction publishes tomorrow's prices after 13:00 market time.
const AUCTION_HOUR: i8 = 13;

const PRICE_DAY: Stream = Stream(40);
const PRICE_SLOT: Stream = Stream(41);

/// The simulated wall clock the providers read, in Unix seconds.
#[derive(Debug, Clone, Default)]
pub struct Clock(Arc<AtomicI64>);

impl Clock {
    pub fn set(&self, unix: i64) {
        self.0.store(unix, Ordering::Relaxed);
    }

    fn now(&self) -> i64 {
        self.0.load(Ordering::Relaxed)
    }
}

/// The weather forecast a provider would answer at the simulated now.
pub struct Forecasts {
    pub sky: Sky,
    pub clock: Clock,
    pub zone: TimeZone,
}

impl weather::Provider for Forecasts {
    fn fetch(&self, _: Location) -> impl Future<Output = Result<Vec<Slot>, weather::Error>> + Send {
        let issued = self.clock.now();
        let start = local_midnight(issued, &self.zone);
        let slots = (0..FORECAST_DAYS * 96)
            .map(|q| {
                self.sky
                    .slot(self.sky.forecast(start + q * QUARTER, issued))
            })
            .collect();
        std::future::ready(Ok(slots))
    }
}

/// Past weather, hourly, as the measured sky was.
pub struct Archive {
    pub sky: Sky,
    pub clock: Clock,
}

impl weather::Archive for Archive {
    fn fetch(
        &self,
        _: Location,
        from: jiff::civil::Date,
        to: jiff::civil::Date,
    ) -> impl Future<Output = Result<Vec<Slot>, weather::Error>> + Send {
        let start = day_start(from);
        let end = day_start(to) + 86_400;
        // Hours not yet passed are not settled.
        let end = end.min(self.clock.now().div_euclid(HOUR) * HOUR);
        let slots = (start..end)
            .step_by(3600)
            .map(|hour| self.sky.slot(self.sky.at(hour)))
            .collect();
        std::future::ready(Ok(slots))
    }
}

/// Day-ahead prices: a season, a daily shape with a solar dip, and noise per slot.
pub struct Prices {
    pub noise: Noise,
    pub sky: Sky,
    pub zone: TimeZone,
}

impl Prices {
    /// EUR/kWh of the 15 minutes from `start`.
    #[must_use]
    pub fn price(&self, start: i64) -> f64 {
        let local = jiff::Timestamp::from_second(start)
            .map(|t| t.to_zoned(self.zone.clone()))
            .ok();
        let (hour, weekday) = local
            .as_ref()
            .map_or((12, 1), |z| (z.hour(), z.weekday().to_monday_one_offset()));
        let day = start.div_euclid(86_400);
        let sunny = self.sky.clearness(day * 86_400 + 12 * HOUR);
        let level = self.noise.unit(PRICE_DAY, day).mul_add(0.04, 0.07);
        let shape = match hour {
            0..=5 => 0.85,
            7..=8 => 1.3,
            10..=15 => sunny.mul_add(-0.9, 1.15),
            17..=20 => 1.45,
            _ => 1.0,
        };
        let weekend = if weekday >= 6 { -0.02 } else { 0.0 };
        let noise = (self.noise.unit(PRICE_SLOT, start) - 0.5) * 0.01;
        level.mul_add(shape, weekend + noise)
    }
}

impl spot::Provider for Prices {
    fn fetch(
        &self,
        _: BiddingZone,
        at: std::time::SystemTime,
    ) -> impl Future<Output = Result<Vec<spot::Slot>, spot::Error>> + Send {
        let at = crate::unix(at);
        let start = local_midnight(at, &self.zone);
        let auctioned = jiff::Timestamp::from_second(at)
            .is_ok_and(|t| t.to_zoned(self.zone.clone()).hour() >= AUCTION_HOUR);
        let days = if auctioned { 2 } else { 1 };
        let slots = (0..days * 96)
            .map(|q| {
                let start = start + q * QUARTER;
                spot::Slot {
                    start: crate::instant(start),
                    price: self.price(start),
                }
            })
            .collect();
        std::future::ready(Ok(slots))
    }
}

/// A weather quantity the archive stores as history: its role, unit, step and value.
pub struct Archived {
    pub role: &'static str,
    pub unit: &'static str,
    pub step: f64,
    pub value: fn(&Slot) -> Option<f64>,
}

/// The measured quantities the core's weather device stores from the archive (ADR 17, 23), in
/// its steps; an import in another step is refused, so a drift here fails loudly.
pub const ARCHIVED: [Archived; 14] = [
    Archived {
        role: "weather.ghi",
        unit: "W/m²",
        step: 0.1,
        value: |s| Some(s.ghi),
    },
    Archived {
        role: "weather.dni",
        unit: "W/m²",
        step: 0.1,
        value: |s| Some(s.dni),
    },
    Archived {
        role: "weather.dhi",
        unit: "W/m²",
        step: 0.1,
        value: |s| Some(s.dhi),
    },
    Archived {
        role: "weather.temperature",
        unit: "°C",
        step: 0.1,
        value: |s| Some(s.temperature),
    },
    Archived {
        role: "weather.wind",
        unit: "m/s",
        step: 0.01,
        value: |s| s.wind,
    },
    Archived {
        role: "weather.precipitation",
        unit: "mm/h",
        step: 0.01,
        value: |s| s.detail.precipitation,
    },
    Archived {
        role: "weather.snowfall",
        unit: "cm/h",
        step: 0.01,
        value: |s| s.detail.snowfall,
    },
    Archived {
        role: "weather.humidity",
        unit: "%",
        step: 0.1,
        value: |s| s.detail.humidity,
    },
    Archived {
        role: "weather.wind_direction",
        unit: "°",
        step: 1.0,
        value: |s| s.detail.wind_direction,
    },
    Archived {
        role: "weather.gusts",
        unit: "m/s",
        step: 0.01,
        value: |s| s.detail.gusts,
    },
    Archived {
        role: "weather.apparent_temperature",
        unit: "°C",
        step: 0.1,
        value: |s| s.detail.apparent_temperature,
    },
    Archived {
        role: "weather.sunshine",
        unit: "s",
        step: 1.0,
        value: |s| s.detail.sunshine,
    },
    Archived {
        role: "weather.cloud_cover",
        unit: "%",
        step: 1.0,
        value: |s| s.detail.cloud_cover,
    },
    Archived {
        role: "weather.snow_depth",
        unit: "m",
        step: 0.001,
        value: |s| s.detail.snow_depth,
    },
];

fn day_start(date: jiff::civil::Date) -> i64 {
    date.to_zoned(TimeZone::UTC)
        .map_or(0, |z| z.timestamp().as_second())
}

/// The start of the local day holding `unix` in `zone`.
#[must_use]
pub fn local_midnight(unix: i64, zone: &TimeZone) -> i64 {
    jiff::Timestamp::from_second(unix)
        .ok()
        .and_then(|t| t.to_zoned(zone.clone()).start_of_day().ok())
        .map_or(unix, |z| z.timestamp().as_second())
}
