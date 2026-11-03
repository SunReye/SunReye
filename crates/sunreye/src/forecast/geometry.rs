//! Sun position (Spencer 1971 declination and equation of time) and the angle of incidence on a plane.

use std::f64::consts::PI;

use jiff::Timestamp;
use jiff::tz::TimeZone;

const DEG: f64 = PI / 180.0;
const DAY_MS: f64 = 86_400_000.0;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SunPosition {
    /// Above the horizon, degrees; negative below it.
    pub elevation_deg: f64,
    /// Degrees: 0 south, -90 east, 90 west.
    pub azimuth_deg: f64,
}

/// The sun at `at_ms` (UTC epoch milliseconds) seen from a location.
pub fn sun_position(latitude_deg: f64, longitude_deg: f64, at_ms: i64) -> SunPosition {
    let at = TimeZone::UTC.to_datetime(Timestamp::from_millisecond(at_ms).unwrap_or(if at_ms < 0 {
        Timestamp::MIN
    } else {
        Timestamp::MAX
    }));
    let since_year_start_ms = i64::from(at.day_of_year() - 1) * 86_400_000
        + i64::from(at.hour()) * 3_600_000
        + i64::from(at.minute()) * 60_000
        + i64::from(at.second()) * 1000
        + i64::from(at.millisecond());
    #[allow(clippy::cast_precision_loss, reason = "milliseconds within one year are exact in f64")]
    let gamma = (since_year_start_ms as f64 / DAY_MS) * ((2.0 * PI) / 365.0);

    let declination = 0.006_918 - 0.399_912 * gamma.cos() + 0.070_257 * gamma.sin()
        - 0.006_758 * (2.0 * gamma).cos()
        + 0.000_907 * (2.0 * gamma).sin()
        - 0.002_697 * (3.0 * gamma).cos()
        + 0.001_48 * (3.0 * gamma).sin();
    let eq_of_time_min = 229.18
        * (0.000_075 + 0.001_868 * gamma.cos()
            - 0.032_077 * gamma.sin()
            - 0.014_615 * (2.0 * gamma).cos()
            - 0.040_849 * (2.0 * gamma).sin());

    // Whole seconds, as 3.x read them; the fraction enters through `gamma` only.
    let utc_min = f64::from(at.hour()) * 60.0 + f64::from(at.minute()) + f64::from(at.second()) / 60.0;
    let solar_min = utc_min + 4.0 * longitude_deg + eq_of_time_min;
    let hour_angle = (solar_min / 4.0 - 180.0) * DEG;

    let lat = latitude_deg * DEG;
    let sin_elevation = lat.sin() * declination.sin() + lat.cos() * declination.cos() * hour_angle.cos();
    let azimuth = hour_angle.sin().atan2(hour_angle.cos() * lat.sin() - declination.tan() * lat.cos());
    SunPosition { elevation_deg: sin_elevation.asin() / DEG, azimuth_deg: azimuth / DEG }
}

/// Cosine of the angle between the sun and a plane's normal; 0 or below means the sun is behind the plane.
pub fn cos_aoi(sun: SunPosition, tilt_deg: f64, plane_azimuth_deg: f64) -> f64 {
    let elevation = sun.elevation_deg * DEG;
    let tilt = tilt_deg * DEG;
    elevation.sin() * tilt.cos()
        + elevation.cos() * tilt.sin() * ((sun.azimuth_deg - plane_azimuth_deg) * DEG).cos()
}
