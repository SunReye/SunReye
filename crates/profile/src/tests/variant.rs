//! Identify-probe variants (ADR 5): one file per family, each variant the base with its overrides.

use crate::{LoadError, Profile, Registers};
use serde_json::{Value, json};

fn family() -> Value {
    json!({
        "schema": 1, "id": "family", "name": "Family", "manufacturer": "test", "version": "1.0.0",
        "requires": super::all(),
        "identify": [
            { "register": 0, "values": [0x0500] },
            { "register": 20, "type": "u32" },
        ],
        "inverter": {
            "maxInputVoltage": 800, "acRating": 20_000,
            "mppt": [{ "maxCurrent": 36, "minVoltage": 160, "maxVoltage": 650, "startVoltage": 160 }],
        },
        "quantities": [
            { "key": "pv1", "role": "pv.mppt.power", "index": 1, "register": 672, "type": "u16" },
            { "key": "pv2", "role": "pv.mppt.power", "index": 2, "register": 673, "type": "u16" },
            { "key": "total", "role": "pv.power", "compute": { "sum": ["pv1", "pv2"] } },
            { "key": "spare", "role": "extra.spare", "kind": "measurement", "unit": "W",
              "compute": { "clamp": { "key": "total", "min": 0 } } },
        ],
        "settings": [
            { "key": "current", "type": "u16", "range": { "min": 0, "max": 350 }, "minInterval": 60,
              "recipe": [{ "write": { "register": 108 } }], "readBack": { "register": 108 } },
            { "key": "mode", "type": "u16", "values": [0, 1], "minInterval": 60,
              "recipe": [{ "write": { "register": 142 } }], "readBack": { "register": 142 } },
        ],
        "variants": [
            {
                "id": "5k", "name": "Family 5K",
                "identify": [{ "register": 20, "values": [50_000] }],
                "inverter": {
                    "maxInputVoltage": 800, "acRating": 5000,
                    "mppt": [{ "maxCurrent": 20, "minVoltage": 200, "maxVoltage": 650, "startVoltage": 160 }],
                },
                "settings": { "current": { "min": 0, "max": 120 } },
                "drop": ["pv2", "total"],
                "add": [{ "key": "total", "role": "pv.power", "compute": { "sum": ["pv1"] } }],
            },
            {
                "id": "15k", "name": "Family 15K",
                "identify": [{ "register": 20, "values": [150_000] }],
                "add": [{ "key": "fan", "role": "extra.fan", "kind": "status", "register": 90, "type": "u16" }],
            },
        ],
    })
}

fn load(doc: &Value) -> Result<Profile, LoadError> {
    Profile::load(&doc.to_string())
}

/// The family with `field` of its first variant set to `value`.
fn first_variant(field: &str, value: &Value) -> Value {
    let mut doc = family();
    doc["variants"][0][field] = value.clone();
    doc
}

fn refusal(doc: &Value) -> String {
    load(doc).unwrap_err().to_string()
}

/// A Deye-shaped device: its type in register 0, its rating in 20 and 21, low word first.
fn device(kind: u16, deciwatts: u32) -> Registers {
    let mut registers = Registers::default();
    registers.answer(0, &[kind]);
    #[expect(
        clippy::cast_possible_truncation,
        reason = "splitting a u32 into its words"
    )]
    registers.answer(20, &[deciwatts as u16, (deciwatts >> 16) as u16]);
    registers
}

fn keys(profile: &Profile) -> Vec<&str> {
    profile
        .quantities()
        .iter()
        .map(|q| q.key.as_str())
        .collect()
}

#[test]
fn a_family_lists_its_variants_by_id_and_name() {
    let family = load(&family()).unwrap();

    let listed: Vec<_> = family
        .variants()
        .iter()
        .map(|v| (v.variant(), v.name.as_str()))
        .collect();

    assert_eq!(
        listed,
        [(Some("5k"), "Family 5K"), (Some("15k"), "Family 15K")]
    );
    assert_eq!(family.variant(), None);
}

#[test]
fn a_variant_is_the_base_with_its_name_inverter_and_setting_ranges() {
    let family = load(&family()).unwrap();

    let small = family.resolve(Some("5k"));

    assert_eq!(
        (small.id.as_str(), small.name.as_str()),
        ("family", "Family 5K")
    );
    assert_eq!(small.inverter().and_then(|i| i.ac_rating), Some(5000.0));
    assert_eq!(small.inverter().map(|i| i.mppt[0].max_current), Some(20.0));
    let range = small.setting("current").and_then(crate::Setting::range);
    assert_eq!(range, Some((0.0, 120.0)));
}

#[test]
fn a_quantity_added_under_a_dropped_key_takes_its_place_and_others_follow_the_base() {
    let family = load(&family()).unwrap();

    assert_eq!(keys(family.resolve(Some("5k"))), ["pv1", "total", "spare"]);
    assert_eq!(
        keys(family.resolve(Some("15k"))),
        ["pv1", "pv2", "total", "spare", "fan"]
    );
}

#[test]
fn an_unknown_variant_and_none_resolve_to_the_base() {
    let family = load(&family()).unwrap();

    assert_eq!(family.resolve(Some("99k")).variant(), None);
    assert_eq!(family.resolve(None).name, "Family");
}

#[test]
fn the_probe_picks_the_variant_whose_values_the_device_holds_else_the_base() {
    let family = load(&family()).unwrap();

    let found = |registers: &Registers| family.identify(registers).map(|p| p.variant());

    assert_eq!(found(&device(0x0500, 150_000)), Some(Some("15k")));
    assert_eq!(found(&device(0x0500, 50_000)), Some(Some("5k")));
    assert_eq!(
        found(&device(0x0500, 70_000)),
        Some(None),
        "the base serves"
    );
    assert_eq!(found(&device(0x0600, 150_000)), None);
}

#[test]
fn a_family_reads_one_probe_plan_for_every_variant() {
    let family = load(&family()).unwrap();

    let plans: Vec<_> = family
        .variants()
        .iter()
        .map(|v| v.identify_plan())
        .collect();

    assert!(plans.iter().all(|plan| *plan == family.identify_plan()));
}

#[test]
fn variants_require_their_capability() {
    let mut doc = family();
    doc["requires"] = super::all_but("variants");

    assert_eq!(
        load(&doc).unwrap_err(),
        LoadError::Unrequired("variants".into())
    );
}

#[test]
fn a_profile_without_an_identify_probe_has_no_variants() {
    let mut doc = family();
    doc.as_object_mut().unwrap().remove("identify");

    assert_eq!(
        refusal(&doc),
        "malformed profile: variants need an identify probe"
    );
}

#[test]
fn a_variant_id_is_short_lowercase_letters_digits_and_hyphens() {
    for id in ["", "15K", "15 k", "a-very-long-variant-id"] {
        assert_eq!(
            refusal(&first_variant("id", &json!(id))),
            format!("variant `{id}`: an id is 1 to 16 lowercase letters, digits or hyphens")
        );
    }
}

#[test]
fn a_variant_id_is_declared_once() {
    assert_eq!(
        refusal(&first_variant("id", &json!("15k"))),
        "variant `15k`: the id is declared twice"
    );
}

#[test]
fn a_variant_overrides_only_the_bases_identify_fields() {
    let doc = first_variant("identify", &json!([{ "register": 21, "values": [1] }]));

    assert_eq!(
        refusal(&doc),
        "variant `5k`: identify register 21 is not a field of the base"
    );
}

#[test]
fn a_variant_cannot_change_an_identify_fields_type() {
    let doc = first_variant(
        "identify",
        &json!([{ "register": 20, "type": "u16", "values": [1] }]),
    );

    assert!(refusal(&doc).contains("unknown field `type`"));
}

#[test]
fn a_variants_identify_value_must_fit_the_bases_field() {
    let doc = first_variant("identify", &json!([{ "register": 0, "values": [65_536] }]));

    assert_eq!(
        refusal(&doc),
        "variant `5k`: identify register 0: a value does not fit the field's type"
    );
}

#[test]
fn two_variants_whose_identify_values_overlap_are_refused() {
    let doc = first_variant(
        "identify",
        &json!([{ "register": 20, "values": [50_000, 150_000] }]),
    );

    assert_eq!(
        refusal(&doc),
        "variant `15k`: its identify values overlap variant `5k`'s"
    );
}

#[test]
fn a_variant_that_leaves_every_field_to_the_base_overlaps_any_other() {
    let mut doc = family();
    doc["variants"][1]
        .as_object_mut()
        .unwrap()
        .remove("identify");

    assert_eq!(
        refusal(&doc),
        "variant `15k`: its identify values overlap variant `5k`'s"
    );
}

#[test]
fn a_variant_ranges_only_a_setting_of_the_base_that_takes_a_range() {
    let unknown = first_variant("settings", &json!({ "speed": { "min": 0, "max": 1 } }));
    let enumerated = first_variant("settings", &json!({ "mode": { "min": 0, "max": 1 } }));

    assert_eq!(
        refusal(&unknown),
        "variant `5k`: setting `speed` is not the base's"
    );
    assert_eq!(
        refusal(&enumerated),
        "variant `5k`: setting `mode` takes values, not a range"
    );
}

#[test]
fn a_variant_drops_only_a_quantity_of_the_base() {
    let doc = first_variant("drop", &json!(["pv9"]));

    assert_eq!(
        refusal(&doc),
        "variant `5k`: quantity `pv9` is not the base's"
    );
}

#[test]
fn a_variant_loads_as_a_whole_profile() {
    let kept = first_variant("drop", &json!(["pv2"]));
    let mut duplicate = family();
    duplicate["variants"][1]["add"] =
        json!([{ "key": "pv1", "role": "pv.power", "register": 1, "type": "u16" }]);

    assert_eq!(
        refusal(&kept),
        "variant `5k`: quantity `total`: an input is not a quantity declared earlier"
    );
    assert_eq!(
        refusal(&duplicate),
        "variant `15k`: quantity `pv1`: the key is declared twice"
    );
}

#[test]
fn a_variant_overrides_nothing_else() {
    let doc = first_variant("manufacturer", &json!("other"));

    assert!(refusal(&doc).contains("unknown field `manufacturer`"));
}

#[test]
fn a_field_without_values_needs_variants() {
    let mut doc = family();
    doc.as_object_mut().unwrap().remove("variants");

    assert_eq!(
        refusal(&doc),
        "identify register 20: a field lists the values it may hold"
    );
}

#[test]
fn a_probe_needs_a_field_with_values() {
    let mut doc = family();
    doc["identify"] = json!([{ "register": 20, "type": "u32" }]);

    assert_eq!(
        refusal(&doc),
        "identify register 20: a probe needs a field that lists values"
    );
}

#[test]
fn a_capability_only_a_variant_uses_is_required_too() {
    let mut doc = first_variant(
        "add",
        &json!([{ "key": "total", "role": "pv.power", "compute": { "sum": ["pv1"] }, "deadband": 5 }]),
    );
    doc["requires"] = super::all_but("deadband");

    assert_eq!(
        refusal(&doc),
        "variant `5k`: `requires` lacks `deadband`, which the profile uses"
    );
}

#[test]
fn a_family_has_the_variants_it_declares_and_sunspec_any_model_id() {
    let family = load(&family()).unwrap();
    let sunspec = Profile::load(include_str!("../../../../profiles/sunspec.json")).unwrap();

    assert!(family.has_variant("5k"));
    assert!(!family.has_variant("99k"));
    assert!(!family.has_variant("103"), "not a SunSpec profile");
    assert!(sunspec.has_variant("103"));
    assert!(!sunspec.has_variant("three-phase"));
}

/// The first variant's inverter section with `change` applied.
fn first_inverter(change: impl FnOnce(&mut Value)) -> Value {
    let mut doc = family();
    change(&mut doc["variants"][0]["inverter"]);
    doc
}

#[test]
fn a_variant_whose_limits_exceed_the_bases_is_refused() {
    let rating = first_inverter(|i| i["acRating"] = json!(20_001));
    let uncapped = first_inverter(|i| {
        i.as_object_mut().unwrap().remove("acRating");
    });
    let input = first_inverter(|i| i["maxInputVoltage"] = json!(801));
    let current = first_inverter(|i| i["mppt"][0]["maxCurrent"] = json!(36.5));
    let voltage = first_inverter(|i| i["mppt"][0]["maxVoltage"] = json!(651));
    let window = first_inverter(|i| i["mppt"][0]["minVoltage"] = json!(159));
    let start = first_inverter(|i| i["mppt"][0]["startVoltage"] = json!(159));

    assert_eq!(
        refusal(&rating),
        "variant `5k`: its AC rating exceeds the base's"
    );
    assert_eq!(
        refusal(&uncapped),
        "variant `5k`: its AC rating exceeds the base's"
    );
    assert_eq!(
        refusal(&input),
        "variant `5k`: its maximum input voltage exceeds the base's"
    );
    for doc in [current, voltage, window, start] {
        assert_eq!(
            refusal(&doc),
            "variant `5k`: MPPT input 1 exceeds the base's limits"
        );
    }
}

#[test]
fn a_variant_may_declare_an_input_the_base_does_not_limit() {
    let doc = first_inverter(|i| {
        let input = i["mppt"][0].clone();
        i["mppt"].as_array_mut().unwrap().push(input);
    });

    assert_eq!(load(&doc).map(|_| ()), Ok(()));
}

#[test]
fn a_variant_replaces_a_quantity_but_never_a_setting() {
    let dropped = first_variant("drop", &json!(["pv2", "total", "current"]));
    let whole = first_variant(
        "settings",
        &json!({ "current": {
            "key": "current", "type": "u16", "range": { "min": 0, "max": 120 }, "minInterval": 1,
            "recipe": [{ "write": { "register": 109 } }], "readBack": { "register": 109 },
        } }),
    );

    assert_eq!(
        refusal(&dropped),
        "variant `5k`: `current` is a setting: a variant changes only its range"
    );
    assert!(refusal(&whole).contains("unknown field `key`"));
}

#[test]
fn a_variant_lists_the_retired_profiles_it_replaces() {
    let doc = first_variant("replaces", &json!(["family-5k", "family-5000"]));

    let family = load(&doc).unwrap();

    assert_eq!(
        family.resolve(Some("5k")).replaces(),
        ["family-5k", "family-5000"]
    );
    assert_eq!(family.resolve(Some("15k")).replaces(), [] as [&str; 0]);
    assert_eq!(family.replaces(), [] as [&str; 0]);
}

#[test]
fn a_retired_profile_is_replaced_by_one_variant_and_never_the_family_itself() {
    let mut twice = first_variant("replaces", &json!(["family-old"]));
    twice["variants"][1]["replaces"] = json!(["family-old"]);
    let own = first_variant("replaces", &json!(["family"]));

    assert_eq!(
        refusal(&twice),
        "variant `15k`: variant `5k` already replaces `family-old`"
    );
    assert_eq!(
        refusal(&own),
        "variant `5k`: it cannot replace its own family"
    );
}
