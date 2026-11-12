//! The sun tint (ADR 21): the backdrop's colour from the sun over the plant.

use super::Location;
use super::tint::{Tint, tint, tint_at};

#[test]
fn the_tint_follows_the_suns_elevation_and_whether_it_is_rising() {
    assert_eq!(tint(0.0, true), Tint::Dawn);
    assert_eq!(tint(55.0, true), Tint::Noon);
    assert_eq!(tint(55.0, false), Tint::Noon);
    assert_eq!(tint(0.0, false), Tint::Dusk);
    assert_eq!(tint(-40.0, false), Tint::Night);
    assert_eq!(tint(-40.0, true), Tint::Night);
}

#[test]
fn twilight_is_warm_full_day_and_full_night_are_not() {
    assert_eq!(tint(-5.0, true), Tint::Dawn);
    assert_eq!(tint(5.0, false), Tint::Dusk);
    assert_eq!(tint(-7.0, true), Tint::Night);
    assert_eq!(tint(7.0, false), Tint::Noon);
}

#[test]
fn berlin_at_midsummer_runs_through_every_tint() {
    let berlin = Location {
        latitude: 52.52,
        longitude: 13.38,
    };
    // 2026-06-21 UTC; sunrise 02:43, sunset 19:33.
    let day = 1_782_000_000;
    let at = |hours: i64, minutes: i64| tint_at(berlin, day + hours * 3600 + minutes * 60);

    assert_eq!(at(0, 0), Tint::Night);
    assert_eq!(at(2, 45), Tint::Dawn);
    assert_eq!(at(10, 0), Tint::Noon);
    assert_eq!(at(19, 35), Tint::Dusk);
    assert_eq!(at(22, 0), Tint::Night);
}
