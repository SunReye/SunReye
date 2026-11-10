//! The quantisation step each quantity is stored in (ADR 3, 5).

use crate::Profile;
use serde_json::{Value, json};

fn steps(quantities: &Value) -> Vec<(String, f64)> {
    let doc = json!({
        "schema": 1, "id": "case", "name": "case", "manufacturer": "test", "version": "1.0.0",
        "requires": super::all(), "quantities": quantities,
    });
    let profile = Profile::load(&doc.to_string()).unwrap();
    profile
        .quantities()
        .iter()
        .map(|q| (q.key.clone(), q.step()))
        .collect()
}

#[test]
fn a_register_is_stored_in_steps_of_its_scale() {
    let quantities = json!([
        { "key": "plain", "role": "extra.plain", "register": 1, "type": "u16" },
        { "key": "tenths", "role": "extra.tenths", "register": 2, "type": "i16", "scale": 0.1,
          "offset": -100 },
        { "key": "negated", "role": "extra.negated", "register": 3, "type": "i16", "scale": -0.01 },
    ]);

    assert_eq!(
        steps(&quantities),
        [
            ("plain".to_owned(), 1.0),
            ("tenths".to_owned(), 0.1),
            ("negated".to_owned(), 0.01),
        ]
    );
}

#[test]
fn a_computed_quantity_takes_its_finest_input_step_and_a_ratio_a_thousandth_of_its_scale() {
    let quantities = json!([
        { "key": "a", "role": "extra.a", "register": 1, "type": "u16" },
        { "key": "b", "role": "extra.b", "register": 2, "type": "u16", "scale": 0.1 },
        { "key": "sum", "role": "extra.sum", "compute": { "sum": ["a", "b"] } },
        { "key": "diff", "role": "extra.diff", "compute": { "diff": ["a", "b"] } },
        { "key": "combine", "role": "extra.combine",
          "compute": { "combine": { "add": ["a"], "sub": ["b"] } } },
        { "key": "clamp", "role": "extra.clamp", "compute": { "clamp": { "key": "b", "min": 0 } } },
        { "key": "ratio", "role": "extra.ratio",
          "compute": { "ratio": { "num": ["a"], "den": ["b"], "scale": 100 } } },
    ]);

    let got = steps(&quantities);

    assert_eq!(
        got[2..],
        [
            ("sum".to_owned(), 0.1),
            ("diff".to_owned(), 0.1),
            ("combine".to_owned(), 0.1),
            ("clamp".to_owned(), 0.1),
            ("ratio".to_owned(), 0.1),
        ]
    );
}
