//! The clear sky the browser runs for a date without weather (ADR 20): Ineichen and Perez 2002 as
//! pvlib's `clearsky.ineichen`, at sea level, since a plant stores no altitude.

use crate::estimate::{SECONDS_PER_DAY, day_of_year};
use crate::perez::{extraterrestrial, relative_airmass};
use crate::{Location, Sun, Weather, sun_position};

/// A typical rural European atmosphere; a monthly climatology would need pvlib's 30 MB table.
const LINKE_TURBIDITY: f64 = 3.0;

/// °C: a clear sky carries no weather, so the cells warm from a mild day.
const AIR_TEMPERATURE: f64 = 20.0;

/// Clear-sky irradiance in W/m².
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Irradiance {
    pub ghi: f64,
    pub dni: f64,
    pub dhi: f64,
}

/// The clear sky under `sun` on `day_of_year`; dark below the horizon.
#[must_use]
pub fn clear_sky(sun: Sun, day_of_year: u16) -> Irradiance {
    if sun.zenith >= 90.0 {
        return Irradiance {
            ghi: 0.0,
            dni: 0.0,
            dhi: 0.0,
        };
    }
    let tl = LINKE_TURBIDITY;
    let airmass = relative_airmass(sun.zenith);
    let cos_zenith = sun.zenith.to_radians().cos().max(0.0);
    let extra = extraterrestrial(day_of_year);
    // At sea level fh1 = fh2 = 1, cg1 = 0.868 and cg2 = 0.0387.
    let ghi = 0.868 * extra * cos_zenith * (-0.0387 * airmass * tl).exp();
    let beam = (0.664 + 0.163) * (-0.09 * airmass * (tl - 1.0)).exp() * extra;
    let corrected = ghi * ((1.0 - 0.2f64.mul_add(-(-tl).exp(), 0.1) / (0.1 + 0.882)) / cos_zenith);
    let dni = beam.min(corrected);
    Irradiance {
        ghi,
        dni,
        dhi: dni.mul_add(-cos_zenith, ghi),
    }
}

/// The weather of a clear sky at `unix` seconds UTC over `location`, still air at 20 °C.
#[must_use]
pub fn clear_weather(unix: i64, location: Location) -> Weather {
    let sky = clear_sky(
        sun_position(unix, location),
        day_of_year(unix.div_euclid(SECONDS_PER_DAY)),
    );
    Weather {
        unix,
        ghi: sky.ghi,
        dni: sky.dni,
        dhi: sky.dhi,
        temperature: AIR_TEMPERATURE,
        wind: None,
    }
}
