//! Settings through the `mqtt` binding (ADR 5, 10): a recipe publishes to topics, and reads back
//! and checks preconditions through the quantities the broker's retained state fills.
//!
//! The topics are EVCC's, <https://docs.evcc.io/en/integrations/mqtt-api>: a loadpoint's state
//! under `loadpoints/<n>/<key>`, written through `loadpoints/<n>/<key>/set`.

use crate::{LoadError, Profile, Source, Step};
use serde_json::{Value, json};

fn doc(settings: &Value) -> Value {
    json!({
        "schema": 1, "id": "case", "name": "case", "manufacturer": "test", "version": "1.0.0",
        "requires": ["mqtt", "u16", "publish", "precondition"],
        "quantities": [
            { "key": "power", "role": "ev.charge.power", "topic": "loadpoints/{address}/chargePower" },
            { "key": "mode", "role": "ev.mode", "topic": "loadpoints/{address}/mode",
              "enum": { "off": 0, "pv": 1, "minpv": 2, "now": 3 } },
            { "key": "limit", "role": "extra.limit", "topic": "loadpoints/{address}/limitSoc" },
        ],
        "settings": settings,
    })
}

fn load(settings: &Value) -> Result<Profile, LoadError> {
    Profile::load(&doc(settings).to_string())
}

fn refusal(settings: &Value) -> (String, &'static str) {
    match load(settings) {
        Err(LoadError::Setting { key, problem }) => (key, problem),
        other => panic!("expected a setting refusal, got {other:?}"),
    }
}

fn mode() -> Value {
    json!({
        "key": "mode", "type": "u16", "values": [0, 1, 2, 3], "minInterval": 0,
        "recipe": [{ "publish": { "topic": "loadpoints/{address}/mode/set" } }],
        "readBack": { "quantity": "mode" },
    })
}

fn limit() -> Value {
    json!({
        "key": "limit", "type": "u16", "range": { "min": 0, "max": 100 }, "minInterval": 0,
        "recipe": [
            { "precondition": { "quantity": "mode", "values": [1, 2] } },
            { "publish": { "topic": "loadpoints/{address}/limitSoc/set" } },
        ],
        "readBack": { "quantity": "limit" },
    })
}

#[test]
fn a_setting_publishes_its_value_and_reads_back_through_a_quantity() {
    let profile = load(&json!([mode(), limit()])).unwrap();
    let limit = profile.setting("limit").unwrap();

    assert_eq!(
        limit.recipe(),
        [
            Step::Precondition {
                source: Source::Quantity(1),
                values: vec![1, 2],
            },
            Step::Publish {
                topic: "loadpoints/{address}/limitSoc/set".to_owned()
            },
        ]
    );
    assert_eq!(limit.read_back(), Some(Source::Quantity(2)));
    assert_eq!(limit.payload(80.0).as_deref(), Some("80"));
    assert!(profile.warnings().is_empty(), "{:?}", profile.warnings());
}

#[test]
fn a_value_publishes_as_the_text_its_read_back_maps_it_to() {
    let profile = load(&json!([mode()])).unwrap();
    let mode = profile.setting("mode").unwrap();

    assert_eq!(mode.payload(2.0).as_deref(), Some("minpv"));
    assert_eq!(mode.payload(3.0).as_deref(), Some("now"));
    let mut unmapped = self::mode();
    unmapped["values"] = json!([0, 4]);
    assert_eq!(
        refusal(&json!([unmapped])),
        ("mode".to_owned(), "each value is a text its read-back maps")
    );
}

#[test]
fn a_read_back_or_precondition_names_a_quantity_read_from_a_topic() {
    for named in [json!("missing"), json!(null)] {
        let mut read = mode();
        read["readBack"] = json!({ "quantity": named });
        assert_eq!(
            refusal(&json!([read])).1,
            "a read-back or precondition names a register or a quantity read from a topic"
        );
    }
    let mut both = limit();
    both["recipe"][0]["precondition"]["register"] = json!(40);
    assert_eq!(
        refusal(&json!([both])).1,
        "a read-back or precondition names a register or a quantity read from a topic"
    );
}

#[test]
fn a_setting_writes_through_its_profiles_binding() {
    let mut register = mode();
    register["recipe"] = json!([{ "write": { "register": 108 } }]);
    assert_eq!(
        refusal(&json!([register])).1,
        "a setting writes through its profile's binding"
    );
    let mut read_register = mode();
    read_register["readBack"] = json!({ "register": 109 });
    assert_eq!(
        refusal(&json!([read_register])).1,
        "a setting writes through its profile's binding"
    );
    let published = json!({
        "schema": 1, "id": "case", "name": "case", "manufacturer": "test", "version": "1.0.0",
        "requires": ["modbus", "u16", "publish"], "quantities": [],
        "settings": [{
            "key": "a", "type": "u16", "values": [0], "minInterval": 0, "writeOnly": true,
            "recipe": [{ "publish": { "topic": "a/set" } }],
        }],
    });
    assert!(matches!(
        Profile::load(&published.to_string()),
        Err(LoadError::Setting {
            problem: "a setting writes through its profile's binding",
            ..
        })
    ));
}

#[test]
fn a_publish_topic_is_a_path_under_the_root_without_wildcards() {
    for topic in ["", "a/#", "a/+/set", "/a"] {
        let mut wild = mode();
        wild["recipe"] = json!([{ "publish": { "topic": topic } }]);
        assert_eq!(
            refusal(&json!([wild])).1,
            "a topic is a path under the root, without wildcards",
            "{topic:?}"
        );
    }
}

#[test]
fn a_publish_without_it_in_requires_is_a_warning() {
    let mut unrequired = doc(&json!([mode()]));
    unrequired["requires"] = json!(["mqtt", "u16"]);
    let profile = Profile::load(&unrequired.to_string()).unwrap();
    assert_eq!(
        profile.warnings(),
        ["`requires` lacks `publish`, which the profile uses"]
    );
}
