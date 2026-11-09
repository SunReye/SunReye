//! The clear sky against pvlib's Ineichen–Perez (`fixtures/clearsky.csv`).

use super::fixtures::{assert_close, rows};
use crate::{Location, Sun, clear_sky, clear_weather, sun_position};

#[test]
fn clear_sky_matches_pvlib_ineichen() {
    for row in rows(include_str!("../../fixtures/clearsky.csv")) {
        let sun = Sun {
            zenith: row.get("zenith"),
            azimuth: 0.0,
        };
        let day_of_year = row.get("day_of_year");

        let sky = clear_sky(sun, day_of_year);

        let what = format!("zenith {} day {day_of_year}", sun.zenith);
        assert_close(sky.ghi, row.get("ghi"), &format!("{what} ghi"));
        assert_close(sky.dni, row.get("dni"), &format!("{what} dni"));
        assert_close(sky.dhi, row.get("dhi"), &format!("{what} dhi"));
    }
}

const BERLIN: Location = Location {
    latitude: 52.52,
    longitude: 13.38,
};

#[test]
fn a_clear_day_is_dark_at_midnight_and_carries_the_suns_clear_sky_at_noon() {
    // 2026-06-21T00:00Z and 11:00Z.
    let (midnight, noon) = (1_782_000_000, 1_782_039_600);

    let dark = clear_weather(midnight, BERLIN);
    let bright = clear_weather(noon, BERLIN);

    assert_eq!((dark.ghi, dark.dni, dark.dhi), (0.0, 0.0, 0.0));
    let sky = clear_sky(sun_position(noon, BERLIN), 172);
    assert_eq!(
        (bright.ghi, bright.dni, bright.dhi),
        (sky.ghi, sky.dni, sky.dhi)
    );
    assert_eq!(
        (bright.unix, bright.temperature, bright.wind),
        (noon, 20.0, None)
    );
}
