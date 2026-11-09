//! Settings (ADR 5, 7): a recipe of write steps, a read-back, and the values a write may carry.

use std::time::Duration;

use crate::{Field, LoadError, Profile, Relock, Step};
use serde_json::{Value, json};

fn doc(settings: &Value) -> Value {
    json!({
        "schema": 1, "id": "case", "name": "case", "manufacturer": "test", "version": "1.0.0",
        "requires": ["modbus", "write"], "quantities": [], "settings": settings,
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

/// A battery current in amperes, written to 108 and read back from 109.
fn current() -> Value {
    json!({
        "key": "current", "type": "u16", "range": { "min": 0, "max": 350 }, "minInterval": 60,
        "recipe": [{ "write": { "register": 108 } }], "readBack": { "register": 109 },
    })
}

#[test]
fn a_setting_declares_its_recipe_read_back_and_minimum_interval() {
    let profile = load(&json!([current()])).unwrap();

    let setting = profile.setting("current").unwrap();

    assert_eq!(setting.recipe(), [Step::Write { register: 108 }]);
    assert_eq!(
        setting.read_back(),
        Some(Field {
            register: 109,
            mask: 0xFFFF
        })
    );
    assert_eq!(setting.min_interval(), Duration::from_mins(1));
    assert!(profile.setting("voltage").is_none());
}

#[test]
fn a_value_is_encoded_at_its_scale_only_inside_its_range() {
    let mut volts = current();
    volts["type"] = json!("i16");
    volts["scale"] = json!(0.1);
    volts["range"] = json!({ "min": -10, "max": 60 });
    let mut energy = current();
    energy["type"] = json!("u32");
    energy["range"] = json!({ "min": 0, "max": 100_000 });
    let volts = load(&json!([volts])).unwrap();
    let energy = load(&json!([energy])).unwrap();
    let volts = volts.setting("current").unwrap();
    let energy = energy.setting("current").unwrap();

    assert_eq!(volts.encode(52.3), Some(vec![523]));
    assert_eq!(volts.encode(-1.5), Some(vec![0xFFF1]));
    assert_eq!(energy.encode(70_000.0), Some(vec![4464, 1]));
    for refused in [60.1, -10.1, 52.35, f64::NAN, f64::INFINITY] {
        assert_eq!(volts.encode(refused), None, "{refused}");
    }
}

#[test]
fn an_enumerated_setting_takes_only_its_values() {
    let mode = json!({
        "key": "mode", "type": "u16", "values": [0, 1, 2], "minInterval": 60,
        "recipe": [{ "write": { "register": 142 } }], "readBack": { "register": 142 },
    });
    let profile = load(&json!([mode])).unwrap();
    let mode = profile.setting("mode").unwrap();

    assert_eq!(mode.encode(2.0), Some(vec![2]));
    assert_eq!(mode.encode(3.0), None);
    assert_eq!(mode.encode(1.5), None);
}

#[test]
fn words_read_back_decode_at_the_settings_scale() {
    let mut volts = current();
    volts["type"] = json!("i16");
    volts["scale"] = json!(0.1);
    let profile = load(&json!([volts])).unwrap();
    let volts = profile.setting("current").unwrap();

    assert_eq!(volts.width(), 1);
    assert_eq!(volts.decode(&[0xFFF1]), Some(-1.5));
    assert_eq!(volts.decode(&[]), None);
}

#[test]
fn a_recipe_reads_back_unless_its_setting_is_write_only() {
    let mut silent = current();
    silent.as_object_mut().unwrap().remove("readBack");
    assert_eq!(
        refusal(&json!([silent])),
        (
            "current".into(),
            "declare a `readBack`, or `writeOnly` when the device cannot be read"
        )
    );
    silent["writeOnly"] = json!(true);
    assert_eq!(
        load(&json!([silent]))
            .unwrap()
            .setting("current")
            .unwrap()
            .read_back(),
        None
    );
    let mut both = current();
    both["writeOnly"] = json!(true);
    assert_eq!(
        refusal(&json!([both])).1,
        "declare a `readBack`, or `writeOnly` when the device cannot be read"
    );
}

#[test]
fn a_setting_is_bounded_and_has_steps() {
    let mut unbounded = current();
    unbounded.as_object_mut().unwrap().remove("range");
    assert_eq!(
        refusal(&json!([unbounded])).1,
        "declare its `range` or its `values`"
    );
    let mut flat = current();
    flat["scale"] = json!(0);
    assert_eq!(
        refusal(&json!([flat])).1,
        "the scale must be a non-zero number"
    );
    let mut inverted = current();
    inverted["range"] = json!({ "min": 10, "max": 0 });
    assert_eq!(refusal(&json!([inverted])).1, "the range is inverted");
    let mut empty = current();
    empty["recipe"] = json!([]);
    assert_eq!(refusal(&json!([empty])).1, "the recipe has no step");
    assert_eq!(
        refusal(&json!([current(), current()])).1,
        "the key is declared twice"
    );
}

fn with_recipe(recipe: &Value) -> Value {
    let mut setting = current();
    setting["recipe"] = recipe.clone();
    setting
}

fn warnings(settings: &Value, requires: &Value) -> Vec<String> {
    let mut doc = doc(settings);
    doc["requires"] = requires.clone();
    Profile::load(&doc.to_string()).unwrap().warnings().to_vec()
}

#[test]
fn a_delay_waits_between_steps_for_at_most_ten_seconds() {
    let recipe = json!([{ "write": { "register": 108 } }, { "delay": { "ms": 500 } }]);
    let profile = load(&json!([with_recipe(&recipe)])).unwrap();

    assert_eq!(
        profile.setting("current").unwrap().recipe(),
        [
            Step::Write { register: 108 },
            Step::Delay(Duration::from_millis(500))
        ]
    );
    let long = json!([{ "write": { "register": 108 } }, { "delay": { "ms": 10_001 } }]);
    assert_eq!(
        refusal(&json!([with_recipe(&long)])).1,
        "a delay is at most 10000 ms: the device's polls wait for it"
    );
    assert_eq!(
        warnings(
            &json!([with_recipe(&recipe)]),
            &json!(["modbus", "u16", "write"])
        ),
        ["`requires` lacks `delay`, which the profile uses"]
    );
}

#[test]
fn a_block_write_carries_the_value_once_among_fixed_words() {
    let recipe = json!([{ "writeBlock": { "register": 100, "words": [1, "value", 0, 7] } }]);
    let profile = load(&json!([with_recipe(&recipe)])).unwrap();

    assert_eq!(
        profile.setting("current").unwrap().recipe(),
        [Step::WriteBlock {
            register: 100,
            head: vec![1],
            tail: vec![0, 7],
        }]
    );
    for words in [json!([1, 0]), json!(["value", 1, "value"])] {
        let recipe = json!([{ "writeBlock": { "register": 100, "words": words } }]);
        assert_eq!(
            refusal(&json!([with_recipe(&recipe)])).1,
            "a block carries `value` exactly once"
        );
    }
    let mut words = vec![json!(0); 123];
    words.push(json!("value"));
    let long = json!([{ "writeBlock": { "register": 100, "words": words } }]);
    assert_eq!(
        refusal(&json!([with_recipe(&long)])).1,
        "a block is at most 123 registers"
    );
    assert_eq!(
        warnings(&json!([with_recipe(&recipe)]), &json!(["modbus", "u16"])),
        ["`requires` lacks `write-block`, which the profile uses"]
    );
}

/// A two-bit field at bits 4 and 5 of register 141, read back through the same mask.
fn mode() -> Value {
    json!({
        "key": "current", "type": "u16", "values": [0, 1, 2, 3], "minInterval": 60,
        "recipe": [{ "rmw": { "register": 141, "mask": 0x30 } }],
        "readBack": { "register": 141, "mask": 0x30 },
    })
}

#[test]
fn a_masked_write_takes_only_values_its_field_holds_and_reads_back_through_its_mask() {
    let mut wide = mode();
    wide["values"] = json!([0, 4]);
    let profile = load(&json!([mode()])).unwrap();
    let mode = profile.setting("current").unwrap();
    let wide = load(&json!([wide])).unwrap();

    assert_eq!(
        mode.recipe(),
        [Step::Rmw {
            register: 141,
            mask: 0x30
        }]
    );
    assert_eq!(
        mode.read_back(),
        Some(Field {
            register: 141,
            mask: 0x30
        })
    );
    assert_eq!(mode.read_back().unwrap().extract(0x1223), 2);
    assert_eq!(mode.encode(3.0), Some(vec![3]));
    assert_eq!(wide.setting("current").unwrap().encode(4.0), None);
    assert_eq!(
        warnings(&json!([self::mode()]), &json!(["modbus", "u16"])),
        ["`requires` lacks `rmw`, which the profile uses"]
    );
}

#[test]
fn a_mask_is_non_zero_over_an_unsigned_register() {
    let mut empty = mode();
    empty["recipe"] = json!([{ "rmw": { "register": 141, "mask": 0 } }]);
    assert_eq!(
        refusal(&json!([empty])).1,
        "a mask selects at least one bit"
    );
    let mut unread = mode();
    unread["readBack"]["mask"] = json!(0);
    assert_eq!(
        refusal(&json!([unread])).1,
        "a mask selects at least one bit"
    );
    for kind in ["i16", "u32"] {
        let mut signed = mode();
        signed["type"] = json!(kind);
        assert_eq!(
            refusal(&json!([signed])).1,
            "a masked register holds a `u16`"
        );
        let mut read = mode();
        read["type"] = json!(kind);
        read["recipe"] = json!([{ "write": { "register": 141 } }]);
        assert_eq!(refusal(&json!([read])).1, "a masked register holds a `u16`");
    }
}

#[test]
fn activation_comes_last_after_the_value_is_written() {
    let recipe = json!([
        { "write": { "register": 108 } },
        { "activate": { "register": 110, "value": 1 } },
    ]);
    let profile = load(&json!([with_recipe(&recipe)])).unwrap();

    assert_eq!(
        profile.setting("current").unwrap().recipe(),
        [
            Step::Write { register: 108 },
            Step::Activate {
                register: 110,
                value: 1
            }
        ]
    );
    assert_eq!(
        warnings(
            &json!([with_recipe(&recipe)]),
            &json!(["modbus", "u16", "write"])
        ),
        ["`requires` lacks `activate`, which the profile uses"]
    );
    let early = json!([
        { "write": { "register": 108 } },
        { "activate": { "register": 110, "value": 1 } },
        { "delay": { "ms": 100 } },
    ]);
    assert_eq!(
        refusal(&json!([with_recipe(&early)])).1,
        "`activate` is the last step, after one that writes the value"
    );
    let alone =
        json!([{ "delay": { "ms": 100 } }, { "activate": { "register": 110, "value": 1 } }]);
    assert_eq!(
        refusal(&json!([with_recipe(&alone)])).1,
        "`activate` is the last step, after one that writes the value"
    );
}

#[test]
fn preconditions_come_before_every_other_step() {
    let recipe = json!([
        { "precondition": { "register": 40, "values": [1, 2] } },
        { "precondition": { "register": 41, "mask": 0x0C, "values": [3] } },
        { "write": { "register": 108 } },
    ]);
    let profile = load(&json!([with_recipe(&recipe)])).unwrap();

    assert_eq!(
        profile.setting("current").unwrap().recipe()[..2],
        [
            Step::Precondition {
                field: Field {
                    register: 40,
                    mask: 0xFFFF
                },
                values: vec![1, 2],
            },
            Step::Precondition {
                field: Field {
                    register: 41,
                    mask: 0x0C
                },
                values: vec![3],
            },
        ]
    );
    assert_eq!(
        warnings(
            &json!([with_recipe(&recipe)]),
            &json!(["modbus", "u16", "write"])
        ),
        ["`requires` lacks `precondition`, which the profile uses"]
    );
    let late = json!([
        { "write": { "register": 108 } },
        { "precondition": { "register": 40, "values": [1] } },
    ]);
    assert_eq!(
        refusal(&json!([with_recipe(&late)])).1,
        "a precondition comes before every other step"
    );
    let empty = json!([
        { "precondition": { "register": 40, "values": [] } },
        { "write": { "register": 108 } },
    ]);
    assert_eq!(
        refusal(&json!([with_recipe(&empty)])).1,
        "a precondition lists the values it allows"
    );
}

/// SMA's Grid Guard: a code in a double word, relocked by writing 0 over it.
fn grid_guard() -> Value {
    json!({ "unlock": { "register": 43090, "type": "u32", "secret": "gridGuard",
        "finally": [{ "register": 43090, "words": [0, 0] }] } })
}

#[test]
fn an_unlock_writes_a_named_secret_and_declares_its_relock() {
    let recipe = json!([
        { "precondition": { "register": 40, "values": [1] } },
        grid_guard(),
        { "write": { "register": 108 } },
    ]);
    let profile = load(&json!([with_recipe(&recipe)])).unwrap();

    let setting = profile.setting("current").unwrap();
    let Step::Unlock(unlock) = &setting.recipe()[1] else {
        panic!("expected an unlock, got {:?}", setting.recipe()[1]);
    };
    assert_eq!(
        (unlock.register, unlock.secret.as_str()),
        (43090, "gridGuard")
    );
    assert_eq!(
        setting.finally(),
        [Relock {
            register: 43090,
            words: vec![0, 0]
        }]
    );
    // A double word is low word first; a code that is not a whole number of the type is refused.
    assert_eq!(unlock.encode("70000"), Some(vec![4464, 1]));
    for code in ["", "abc", "-1", "4294967296", "1.5", " 1"] {
        assert_eq!(unlock.encode(code), None, "{code:?}");
    }
    assert_eq!(
        warnings(
            &json!([with_recipe(&recipe)]),
            &json!(["modbus", "u16", "write", "precondition"])
        ),
        [
            "`requires` lacks `u32`, which the profile uses",
            "`requires` lacks `unlock`, which the profile uses"
        ]
    );
}

#[test]
fn a_recipe_unlocks_once_before_it_writes() {
    let late = json!([{ "write": { "register": 108 } }, grid_guard()]);
    let twice = json!([grid_guard(), grid_guard(), { "write": { "register": 108 } }]);
    for recipe in [late, twice] {
        assert_eq!(
            refusal(&json!([with_recipe(&recipe)])).1,
            "an unlock comes once, after the preconditions and before every write"
        );
    }
    let mut unnamed = grid_guard();
    unnamed["unlock"]["secret"] = json!("");
    let recipe = json!([unnamed, { "write": { "register": 108 } }]);
    assert_eq!(
        refusal(&json!([with_recipe(&recipe)])).1,
        "an unlock names its secret"
    );
    let mut empty = grid_guard();
    empty["unlock"]["finally"] = json!([{ "register": 43090, "words": [] }]);
    let recipe = json!([empty, { "write": { "register": 108 } }]);
    assert_eq!(
        refusal(&json!([with_recipe(&recipe)])).1,
        "a relock writes 1 to 123 registers"
    );
}
