//! Warnings: a profile that loads but says something it should not.

use crate::Profile;
use serde_json::json;

#[test]
fn a_used_capability_missing_from_requires_is_a_warning() {
    let doc = json!({
        "schema": 1, "id": "case", "name": "case", "manufacturer": "test", "version": "1.0.0",
        "requires": ["modbus", "u16"],
        "quantities": [
            { "key": "a", "role": "extra.a", "register": 1, "type": "u16" },
            { "key": "b", "role": "extra.b", "register": 2, "type": "u32" },
            { "key": "c", "role": "extra.c", "compute": { "sum": ["a", "b"] } },
        ],
    });
    let profile = Profile::load(&doc.to_string()).unwrap();
    assert_eq!(
        profile.warnings(),
        [
            "`requires` lacks `u32`, which the profile uses",
            "`requires` lacks `compute`, which the profile uses",
        ]
    );
}

#[test]
fn the_owners_profile_has_no_warning() {
    let profile = Profile::load(include_str!("../../../../profiles/deye-sg05lp3.json")).unwrap();
    assert!(profile.warnings().is_empty(), "{:?}", profile.warnings());
}
