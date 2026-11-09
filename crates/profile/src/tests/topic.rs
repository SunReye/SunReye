//! The `mqtt` binding: a quantity reads a topic under the connection's root, at the device's
//! address, and decodes its payload.

use crate::{LoadError, Profile};
use serde_json::{Value, json};

fn doc(quantities: &Value) -> Value {
    json!({
        "schema": 1, "id": "case", "name": "case", "manufacturer": "test", "version": "1.0.0",
        "requires": ["mqtt", "compute"], "quantities": quantities,
    })
}

fn profile(quantities: &Value) -> Profile {
    Profile::load(&doc(quantities).to_string()).unwrap()
}

fn refusal(quantities: &Value) -> (String, &'static str) {
    match Profile::load(&doc(quantities).to_string()) {
        Err(LoadError::Quantity { key, problem }) => (key, problem),
        other => panic!("expected a quantity refusal, got {other:?}"),
    }
}

/// The value quantity `position` holds after `payload` arrives on its topic.
fn received(profile: &Profile, position: usize, payload: &str) -> Option<f64> {
    let mut values = vec![None; profile.quantities().len()];
    profile.receive(position, payload.as_bytes(), &mut values);
    values[position]
}

fn power() -> Value {
    json!({ "key": "power", "role": "ev.charge.power", "topic": "loadpoints/{address}/chargePower" })
}

#[test]
fn a_topic_names_the_device_address() {
    let p = profile(&json!([
        { "key": "id", "role": "extra.id", "topic": "site/id" },
        power(),
    ]));
    assert_eq!(
        p.topics(2),
        [
            (0, "site/id".to_owned()),
            (1, "loadpoints/2/chargePower".to_owned())
        ]
    );
}

#[test]
fn a_number_payload_is_scaled() {
    let p = profile(&json!([
        { "key": "energy", "role": "ev.session.energy", "topic": "e", "scale": 0.001 },
    ]));
    assert_eq!(received(&p, 0, "4321.5"), Some(4.3215));
    assert_eq!(p.quantities()[0].step(), 0.001);
}

#[test]
fn a_boolean_payload_is_one_or_zero() {
    let p = profile(&json!([{ "key": "on", "role": "ev.charging", "topic": "c" }]));
    assert_eq!(received(&p, 0, "true"), Some(1.0));
    assert_eq!(received(&p, 0, "false"), Some(0.0));
}

#[test]
fn a_null_empty_or_unreadable_payload_is_no_value() {
    let p = profile(&json!([power()]));
    for payload in ["null", "", "pv", "{\"a\":1}"] {
        assert_eq!(received(&p, 0, payload), None, "{payload:?}");
    }
}

#[test]
fn a_computed_quantity_follows_its_topic_inputs() {
    let p = profile(&json!([
        { "key": "a", "role": "extra.a", "topic": "a" },
        { "key": "b", "role": "extra.b", "topic": "b" },
        { "key": "sum", "role": "extra.sum", "compute": { "sum": ["a", "b"] } },
    ]));
    let mut values = vec![None; 3];
    p.receive(0, b"2", &mut values);
    p.receive(1, b"3", &mut values);
    assert_eq!(values, [Some(2.0), Some(3.0), Some(5.0)]);
}

#[test]
fn a_topic_takes_no_register_type_or_wildcard() {
    let with_register = json!([{ "key": "a", "role": "extra.a", "topic": "a", "register": 1 }]);
    assert_eq!(
        refusal(&with_register).1,
        "declare one of `register`, `topic` or `compute`"
    );
    let typed = json!([{ "key": "a", "role": "extra.a", "topic": "a", "type": "u16" }]);
    assert_eq!(refusal(&typed).1, "a topic takes no type");
    for topic in ["", "a/#", "a/+/b", "/a"] {
        let wild = json!([{ "key": "a", "role": "extra.a", "topic": topic }]);
        assert_eq!(
            refusal(&wild).1,
            "a topic is a path under the root, without wildcards",
            "{topic:?}"
        );
    }
}

#[test]
fn a_profile_reads_through_one_binding() {
    let mixed = json!([
        { "key": "a", "role": "extra.a", "register": 1, "type": "u16" },
        { "key": "b", "role": "extra.b", "topic": "b" },
    ]);
    assert_eq!(
        refusal(&mixed),
        ("b".to_owned(), "a profile reads through one binding")
    );
}

#[test]
fn a_topic_without_mqtt_in_requires_is_a_warning() {
    let mut unrequired = doc(&json!([power()]));
    unrequired["requires"] = json!([]);
    let p = Profile::load(&unrequired.to_string()).unwrap();
    assert_eq!(
        p.warnings(),
        ["`requires` lacks `mqtt`, which the profile uses"]
    );
}

#[test]
fn a_topic_profile_has_no_read_plan() {
    assert_eq!(profile(&json!([power()])).read_plan(0), []);
}

/// EVCC's loadpoint mode is a text payload, <https://docs.evcc.io/en/integrations/mqtt-api>.
#[test]
fn a_text_payload_reads_as_the_value_its_enum_maps_it_to() {
    let p = profile(&json!([{ "key": "mode", "role": "ev.mode", "topic": "m",
        "enum": { "off": 0, "pv": 1, "minpv": 2, "now": 3 } }]));
    assert_eq!(received(&p, 0, "minpv"), Some(2.0));
    assert_eq!(received(&p, 0, "\"now\""), None);
    assert_eq!(received(&p, 0, "fast"), None);
    assert_eq!(received(&p, 0, "1"), None);
}

#[test]
fn only_a_topic_maps_texts() {
    let registered = json!([{ "key": "a", "role": "extra.a", "register": 1, "type": "u16",
        "enum": { "on": 1 } }]);
    let doc = json!({
        "schema": 1, "id": "case", "name": "case", "manufacturer": "test", "version": "1.0.0",
        "requires": ["modbus", "u16"], "quantities": registered,
    });
    assert!(matches!(
        Profile::load(&doc.to_string()),
        Err(LoadError::Quantity {
            problem: "only a topic maps texts",
            ..
        })
    ));
}
