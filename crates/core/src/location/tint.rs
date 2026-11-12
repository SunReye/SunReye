//! The sun tint (ADR 21): warm at dawn and dusk, clear by day, indigo at night. Pure.

use serde::Serialize;
use sunreye_pv::sun_position;
use utoipa::ToSchema;

use super::Location;

/// Civil twilight's edge and its mirror above the horizon bound the warm tints, in degrees.
const TWILIGHT: f64 = 6.0;

/// The backdrop's tint for the sun over the plant.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum Tint {
    Dawn,
    Noon,
    Dusk,
    Night,
}

/// The tint for the sun `elevation` degrees above the horizon, climbing or not.
pub(super) fn tint(elevation: f64, rising: bool) -> Tint {
    if elevation < -TWILIGHT {
        Tint::Night
    } else if elevation >= TWILIGHT {
        Tint::Noon
    } else if rising {
        Tint::Dawn
    } else {
        Tint::Dusk
    }
}

/// The tint over `location` at `unix` seconds UTC.
pub(super) fn tint_at(location: Location, unix: i64) -> Tint {
    let elevation = |unix| {
        let place = sunreye_pv::Location {
            latitude: location.latitude,
            longitude: location.longitude,
        };
        90.0 - sun_position(unix, place).zenith
    };
    let here = elevation(unix);
    tint(here, elevation(unix + 60) > here)
}
