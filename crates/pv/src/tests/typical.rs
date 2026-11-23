//! A typical year and the cautious yield (ADR 17): a site's typical year from twenty or more past
//! years, a layout's irradiation, and P50 and P90 by scaling the simulated year.

use crate::Location;

#[test]
fn a_site_is_its_location_to_a_hundredth_of_a_degree() {
    let at = Location {
        latitude: 52.516_6,
        longitude: -13.374_9,
    };

    assert_eq!(
        at.rounded(),
        Location {
            latitude: 52.52,
            longitude: -13.37
        }
    );
}
