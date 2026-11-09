//! Sun position against NREL SPA as pvlib 0.16.1 computes it (`fixtures/sun.csv`).

use super::fixtures::rows;
use crate::{Location, sun_position};

/// Far below what moves a PV estimate: 0.02° is under 5 s of the sun's daily path.
const DEGREES: f64 = 0.02;

#[test]
fn sun_position_matches_nrel_spa() {
    for (i, row) in rows(include_str!("../../fixtures/sun.csv"))
        .iter()
        .enumerate()
    {
        let location = Location {
            latitude: row.get("latitude"),
            longitude: row.get("longitude"),
        };

        let sun = sun_position(row.get("unix"), location);

        let zenith: f64 = row.get("zenith");
        let azimuth: f64 = row.get("azimuth");
        assert!(
            (sun.zenith - zenith).abs() < DEGREES,
            "row {i} zenith: {} != SPA {zenith}",
            sun.zenith
        );
        // Wrapped, so −180° and 180° (north) agree.
        let off = (sun.azimuth - azimuth + 540.0).rem_euclid(360.0) - 180.0;
        assert!(
            off.abs() < DEGREES,
            "row {i} azimuth: {} != SPA {azimuth}",
            sun.azimuth
        );
    }
}
