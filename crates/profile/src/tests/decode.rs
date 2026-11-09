//! v4's decoder tests, through the public interface.

use crate::{Profile, Registers};
use serde_json::{Value, json};

fn profile(quantities: &Value) -> Profile {
    let doc = json!({
        "schema": 1, "id": "case", "name": "case", "manufacturer": "test", "version": "1.0.0",
        "requires": ["modbus", "compute"], "quantities": quantities,
    });
    Profile::load(&doc.to_string()).unwrap()
}

fn registers(pairs: &[(u16, u16)]) -> Registers {
    let mut registers = Registers::default();
    for (address, word) in pairs {
        registers.answer(*address, &[*word]);
    }
    registers
}

fn decoded(profile: &Profile, registers: &Registers) -> Vec<(String, Option<f64>)> {
    let mut values = vec![None; profile.quantities().len()];
    profile.decode(registers, &mut values);
    profile
        .quantities()
        .iter()
        .map(|q| q.key.clone())
        .zip(values)
        .collect()
}

fn value(profile: &Profile, key: &str, registers: &Registers) -> Option<f64> {
    decoded(profile, registers)
        .into_iter()
        .find(|(k, _)| k == key)
        .and_then(|(_, v)| v)
}

fn register(key: &str, address: u16, kind: &str) -> Value {
    json!({ "key": key, "role": format!("extra.{key}"), "register": address, "type": kind })
}

fn computed(key: &str, expr: &Value) -> Value {
    json!({ "key": key, "role": format!("extra.{key}"), "compute": expr })
}

#[test]
fn u16_applies_scale_then_offset() {
    let p = profile(
        &json!([{ "key": "t", "role": "extra.t", "register": 1, "type": "u16", "scale": 0.1, "offset": -100 }]),
    );
    assert_eq!(value(&p, "t", &registers(&[(1, 1250)])), Some(25.0));
}

#[test]
fn i16_reads_twos_complement_as_negative() {
    let p = profile(&json!([register("s", 1, "i16")]));
    assert_eq!(value(&p, "s", &registers(&[(1, 0xfff6)])), Some(-10.0));
}

#[test]
fn u32_is_low_word_first_and_exact_past_the_i32_sign_bit() {
    let p = profile(&json!([register("d", 10, "u32")]));
    assert_eq!(
        value(&p, "d", &registers(&[(10, 0x0002), (11, 0x0001)])),
        Some(65538.0)
    );
    assert_eq!(
        value(&p, "d", &registers(&[(10, 0xffff), (11, 0xffff)])),
        Some(4_294_967_295.0)
    );
}

#[test]
fn an_unanswered_register_is_absent_never_zero() {
    let p = profile(&json!([register("a", 1, "u16"), register("d", 10, "u32")]));
    assert_eq!(
        decoded(&p, &Registers::default()),
        [("a".into(), None), ("d".into(), None)]
    );
    assert_eq!(
        value(&p, "d", &registers(&[(10, 5)])),
        None,
        "half a double word"
    );
    assert_eq!(value(&p, "d", &registers(&[(11, 5)])), None);
    assert_eq!(
        value(&p, "a", &registers(&[(1, 0)])),
        Some(0.0),
        "an answered zero is a reading"
    );
}

#[test]
fn a_range_clamps_at_both_ends_and_leaves_values_inside_alone() {
    let p = profile(
        &json!([{ "key": "soc", "role": "battery.soc", "register": 1, "type": "i16", "range": { "min": 0, "max": 100 } }]),
    );
    assert_eq!(value(&p, "soc", &registers(&[(1, 0xffff)])), Some(0.0));
    assert_eq!(value(&p, "soc", &registers(&[(1, 250)])), Some(100.0));
    assert_eq!(value(&p, "soc", &registers(&[(1, 100)])), Some(100.0));
    assert_eq!(value(&p, "soc", &registers(&[(1, 42)])), Some(42.0));
}

#[test]
fn a_raw_value_that_scales_to_infinity_is_no_reading() {
    let p = profile(
        &json!([{ "key": "x", "role": "extra.x", "register": 1, "type": "u16", "scale": 1e308 }]),
    );
    assert_eq!(value(&p, "x", &registers(&[(1, 65535)])), None);
}

#[test]
fn computed_quantities_follow_their_expressions_and_missing_inputs_read_as_zero() {
    let p = profile(&json!([
        register("a", 1, "u16"),
        register("b", 2, "i16"),
        register("gone", 3, "u16"),
        computed("sum", &json!({ "sum": ["a", "b", "gone"] })),
        computed("diff", &json!({ "diff": ["a", "b"] })),
        computed("mix", &json!({ "combine": { "add": ["a"], "sub": ["b"] } })),
        computed(
            "ratio",
            &json!({ "ratio": { "num": ["a"], "den": ["b"], "scale": 100 } })
        ),
        computed("pos", &json!({ "clamp": { "key": "b", "min": 0 } })),
        computed("cap", &json!({ "clamp": { "key": "a", "max": 10 } })),
    ]));
    let w = registers(&[(1, 40), (2, 0xfff6)]);
    assert_eq!(value(&p, "sum", &w), Some(30.0));
    assert_eq!(value(&p, "diff", &w), Some(50.0));
    assert_eq!(value(&p, "mix", &w), Some(50.0));
    assert_eq!(value(&p, "ratio", &w), Some(40.0 / -10.0 * 100.0));
    assert_eq!(value(&p, "pos", &w), Some(0.0));
    assert_eq!(value(&p, "cap", &w), Some(10.0));
    let none = Registers::default();
    assert_eq!(value(&p, "sum", &none), Some(0.0));
    assert_eq!(
        value(&p, "ratio", &none),
        Some(0.0),
        "a zero denominator reads as 0"
    );
}

#[test]
fn a_computed_quantity_reads_earlier_computed_ones() {
    let p = profile(&json!([
        register("a", 1, "i16"),
        computed("pos", &json!({ "clamp": { "key": "a", "min": 0 } })),
        computed("neg", &json!({ "diff": ["pos", "a"] })),
    ]));
    assert_eq!(value(&p, "neg", &registers(&[(1, 0xfff6)])), Some(10.0));
}

#[test]
fn registers_reused_after_clear_hold_only_the_new_poll() {
    let p = profile(&json!([register("a", 1, "u16"), register("b", 2, "u16")]));
    let mut r = Registers::default();
    r.answer(1, &[7, 8]);
    assert_eq!(value(&p, "b", &r), Some(8.0));
    r.clear();
    r.answer(1, &[9]);
    assert_eq!(
        decoded(&p, &r),
        [("a".into(), Some(9.0)), ("b".into(), None)]
    );
}

/// SunSpec's `sunssf`: a signed power of ten in a register of its own, read with the value.
#[test]
fn a_scale_factor_is_a_power_of_ten_read_from_its_own_register() {
    let p = profile(&json!([{
        "key": "hz", "role": "grid.frequency", "register": 1, "type": "u16",
        "scaleFactor": 2, "resolution": 0.001,
    }]));

    assert_eq!(
        value(&p, "hz", &registers(&[(1, 5999), (2, 0xfffe)])),
        Some(59.99)
    );
    assert_eq!(
        value(&p, "hz", &registers(&[(1, 5999), (2, 1)])),
        Some(59990.0)
    );
    assert_eq!(value(&p, "hz", &registers(&[(1, 5999)])), None);
    assert_eq!(p.quantities()[0].step(), 0.001);
    assert_eq!(
        p.read_plan(0),
        [crate::Block {
            start: 1,
            count: 2,
            grouped: false,
            merged: false
        }]
    );
}
