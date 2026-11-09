//! MPPT inputs and the inverter against hand-worked arithmetic.

use super::fixtures::assert_close;
use crate::{MpptLimits, StringOutput, inverter_power, mppt_output};

const SOUTH: StringOutput = StringOutput {
    current: 5.0,
    voltage: 500.0,
    power: 2500.0,
};
const NORTH: StringOutput = StringOutput {
    current: 4.0,
    voltage: 480.0,
    power: 1920.0,
};

/// Wide enough that neither string touches a limit.
const ROOMY: MpptLimits = MpptLimits {
    max_current: 20.0,
    min_voltage: 150.0,
    max_voltage: 850.0,
    start_voltage: 180.0,
};

#[test]
fn parallel_string_currents_add_and_the_powers_sum() {
    let output = mppt_output(&[SOUTH, NORTH], Some(&ROOMY));

    // 5 A + 4 A; 2500 W + 1920 W at their shared voltage 4420 W / 9 A
    assert_close(output.current, 9.0, "current");
    assert_close(output.power, 4420.0, "power");
    assert_close(output.voltage, 4420.0 / 9.0, "voltage");
}

#[test]
fn parallel_current_is_capped_at_the_inputs_maximum() {
    let limits = MpptLimits {
        max_current: 8.0,
        ..ROOMY
    };

    let output = mppt_output(&[SOUTH, NORTH], Some(&limits));

    // 9 A capped to 8 A at 4420 / 9 V
    assert_close(output.current, 8.0, "current");
    assert_close(output.voltage, 4420.0 / 9.0, "voltage");
    assert_close(output.power, 8.0 * 4420.0 / 9.0, "power");
}

const NOTHING: StringOutput = StringOutput {
    current: 0.0,
    voltage: 0.0,
    power: 0.0,
};

fn assert_nothing(output: StringOutput) {
    assert_close(output.current, 0.0, "current");
    assert_close(output.voltage, 0.0, "voltage");
    assert_close(output.power, 0.0, "power");
}

#[test]
fn below_the_voltage_window_an_input_yields_nothing() {
    let limits = MpptLimits {
        min_voltage: 501.0,
        start_voltage: 180.0,
        ..ROOMY
    };

    assert_nothing(mppt_output(&[SOUTH], Some(&limits)));
}

#[test]
fn below_the_start_voltage_an_input_yields_nothing() {
    let limits = MpptLimits {
        min_voltage: 150.0,
        start_voltage: 501.0,
        ..ROOMY
    };

    assert_nothing(mppt_output(&[SOUTH], Some(&limits)));
}

#[test]
fn dark_strings_yield_nothing() {
    assert_nothing(mppt_output(&[NOTHING, NOTHING], Some(&ROOMY)));
    assert_nothing(mppt_output(&[], None));
}

#[test]
fn above_the_voltage_window_an_input_is_clipped_to_its_top() {
    let limits = MpptLimits {
        max_voltage: 450.0,
        ..ROOMY
    };

    let output = mppt_output(&[SOUTH], Some(&limits));

    // Held at 450 V instead of 500 V, the string's 5 A gives 2250 W.
    assert_close(output.voltage, 450.0, "voltage");
    assert_close(output.current, 5.0, "current");
    assert_close(output.power, 2250.0, "power");
}

#[test]
fn without_limits_nothing_is_capped() {
    let output = mppt_output(&[SOUTH, NORTH], None);

    assert_close(output.current, 9.0, "current");
    assert_close(output.power, 4420.0, "power");
}

#[test]
fn inverter_power_is_the_sum_of_its_inputs() {
    // 2500 W + 1920 W under a 5 kW rating
    assert_close(inverter_power(&[SOUTH, NORTH], 5000.0), 4420.0, "power");
}

#[test]
fn inverter_power_is_capped_at_its_ac_rating() {
    assert_close(inverter_power(&[SOUTH, NORTH], 4000.0), 4000.0, "power");
}
