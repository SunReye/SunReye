//! Cell temperature against pvlib 0.16.1 `temperature.faiman` and `temperature.ross(noct=45)`.

use super::fixtures::assert_close;
use crate::cell_temperature;

#[test]
fn with_wind_the_cell_temperature_follows_faiman() {
    assert_close(
        cell_temperature(800.0, 20.0, Some(3.0)),
        37.574_692_442_882_25,
        "faiman",
    );
    assert_close(
        cell_temperature(350.0, -4.0, Some(0.5)),
        8.315_270_935_960_59,
        "faiman",
    );
}

#[test]
fn without_wind_the_cell_temperature_rises_by_noct() {
    assert_close(cell_temperature(800.0, 20.0, None), 45.0, "noct");
    assert_close(cell_temperature(350.0, -4.0, None), 6.9375, "noct");
}
