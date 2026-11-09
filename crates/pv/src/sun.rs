//! The sun's position: Meeus's low-precision solar coordinates, as NOAA's solar calculator uses
//! them. Within 0.02° of NREL SPA from 2024 to 2030 (`fixtures/sun.csv`), without SPA's tables
//! of periodic terms.

use crate::{Location, Sun};

const UNIX_EPOCH_JULIAN_DAY: f64 = 2_440_587.5;
const J2000: f64 = 2_451_545.0;
const SECONDS_PER_DAY: f64 = 86_400.0;
const DAYS_PER_CENTURY: f64 = 36_525.0;

/// The geometric position, unrefracted, at `unix` seconds UTC; azimuth as ADR 17.
#[must_use]
#[expect(
    clippy::cast_precision_loss,
    reason = "seconds since 1970 stay exact in f64 for 285 million years"
)]
pub fn sun_position(unix: i64, location: Location) -> Sun {
    let day = unix as f64 / SECONDS_PER_DAY;
    let centuries = (day + UNIX_EPOCH_JULIAN_DAY - J2000) / DAYS_PER_CENTURY;
    let (declination, equation_of_time) = solar_coordinates(centuries);

    // Minutes of the UTC day, shifted to local apparent solar time.
    let solar_minutes = 4.0f64.mul_add(
        location.longitude,
        day.rem_euclid(1.0).mul_add(1440.0, equation_of_time),
    );
    let hour_angle = (solar_minutes / 4.0 - 180.0).to_radians();
    let latitude = location.latitude.to_radians();

    let cos_zenith = latitude.sin().mul_add(
        declination.sin(),
        latitude.cos() * declination.cos() * hour_angle.cos(),
    );
    let zenith = cos_zenith.clamp(-1.0, 1.0).acos();
    // From south, positive west, as the hour angle.
    let azimuth = hour_angle.sin().atan2(
        hour_angle
            .cos()
            .mul_add(latitude.sin(), -declination.tan() * latitude.cos()),
    );

    Sun {
        zenith: zenith.to_degrees(),
        azimuth: azimuth.to_degrees(),
    }
}

/// `coefficients[0] + coefficients[1]·t + …`.
fn polynomial(t: f64, coefficients: &[f64]) -> f64 {
    coefficients
        .iter()
        .rev()
        .fold(0.0, |sum, coefficient| sum.mul_add(t, *coefficient))
}

/// The sun's declination in radians and the equation of time in minutes, `centuries` from J2000.
fn solar_coordinates(centuries: f64) -> (f64, f64) {
    let mean_longitude = polynomial(centuries, &[280.466_46, 36_000.769_83, 0.000_303_2])
        .rem_euclid(360.0)
        .to_radians();
    let anomaly = polynomial(centuries, &[357.529_11, 35_999.050_29, -0.000_153_7]).to_radians();
    let eccentricity = polynomial(
        centuries,
        &[0.016_708_634, -0.000_042_037, -0.000_000_126_7],
    );
    let centre = anomaly.sin().mul_add(
        polynomial(centuries, &[1.914_602, -0.004_817, -0.000_014]),
        (2.0 * anomaly).sin().mul_add(
            polynomial(centuries, &[0.019_993, -0.000_101]),
            (3.0 * anomaly).sin() * 0.000_289,
        ),
    );
    let node = polynomial(centuries, &[125.04, -1934.136]).to_radians();
    let apparent_longitude = 0.004_78f64
        .mul_add(-node.sin(), mean_longitude.to_degrees() + centre - 0.005_69)
        .to_radians();
    let obliquity_seconds = polynomial(centuries, &[21.448, -46.815, -0.000_59, 0.001_813]);
    let obliquity = 0.002_56f64
        .mul_add(node.cos(), 23.0 + (26.0 + obliquity_seconds / 60.0) / 60.0)
        .to_radians();
    let declination = (obliquity.sin() * apparent_longitude.sin()).asin();

    let half_tan = (obliquity / 2.0).tan().powi(2);
    let longitude = 2.0 * mean_longitude;
    let terms = [
        half_tan * longitude.sin(),
        -2.0 * eccentricity * anomaly.sin(),
        4.0 * eccentricity * half_tan * anomaly.sin() * longitude.cos(),
        -0.5 * half_tan * half_tan * (2.0 * longitude).sin(),
        -1.25 * eccentricity * eccentricity * (2.0 * anomaly).sin(),
    ];
    (declination, 4.0 * terms.iter().sum::<f64>().to_degrees())
}
