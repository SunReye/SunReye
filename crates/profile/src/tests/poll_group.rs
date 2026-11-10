//! Poll groups (ADR 6): a profile polls slow registers less often than the default cadence.

use std::time::Duration;

use crate::{Block, CADENCE, LoadError, Profile, Quantity};
use serde_json::{Value, json};

fn load(groups: &Value, quantities: &Value) -> Result<Profile, LoadError> {
    let doc = json!({
        "schema": 1, "id": "case", "name": "case", "manufacturer": "test", "version": "1.0.0",
        "requires": super::all(), "pollGroups": groups, "quantities": quantities,
    });
    Profile::load(&doc.to_string())
}

fn plain(start: u16, count: u16) -> Block {
    Block {
        start,
        count,
        grouped: false,
        merged: false,
    }
}

fn refused(key: &str, problem: &'static str) -> LoadError {
    LoadError::Quantity {
        key: key.to_owned(),
        problem,
    }
}

#[test]
fn a_poll_group_reads_its_quantities_at_its_own_cadence() {
    let profile = load(
        &json!({ "slow": 60 }),
        &json!([
            { "key": "power", "role": "pv.power", "register": 500, "type": "u16" },
            { "key": "temp", "role": "extra.temp", "register": 600, "type": "u16",
              "pollGroup": "slow" },
            { "key": "total", "role": "pv.energy.total", "register": 601, "type": "u16",
              "pollGroup": "slow" },
            { "key": "twice", "role": "extra.twice", "compute": { "sum": ["temp", "total"] } },
        ]),
    )
    .unwrap();

    let cadences: Vec<_> = profile.quantities().iter().map(Quantity::cadence).collect();
    let slow = Duration::from_secs(60);
    assert_eq!(cadences, [CADENCE, slow, slow, slow]);
    // The computation's inputs share one transaction, in their group.
    let grouped = Block {
        grouped: true,
        ..plain(600, 2)
    };
    assert_eq!(
        profile.poll_groups(0),
        [(CADENCE, vec![plain(500, 1)]), (slow, vec![grouped])]
    );
    // Every register is still in the one plan a capture or a dump reads.
    assert_eq!(profile.read_plan(0), [plain(500, 1), grouped]);
}

#[test]
fn a_profile_without_poll_groups_polls_everything_at_the_default_cadence() {
    let profile = load(
        &json!({}),
        &json!([{ "key": "power", "role": "pv.power", "register": 500, "type": "u16" }]),
    )
    .unwrap();

    assert_eq!(profile.poll_groups(0), [(CADENCE, vec![plain(500, 1)])]);
}

#[test]
fn a_poll_group_is_declared_and_its_cadence_a_whole_number_of_default_cycles() {
    let quantity = |group: &str| {
        json!([{ "key": "temp", "role": "extra.temp", "register": 600, "type": "u16",
                 "pollGroup": group }])
    };

    assert!(matches!(
        load(&json!({ "slow": 60 }), &quantity("fast")),
        Err(LoadError::Quantity { .. })
    ));
    for cadence in [0, 7] {
        assert_eq!(
            load(&json!({ "slow": cadence }), &quantity("slow")).unwrap_err(),
            LoadError::PollGroup {
                name: "slow".to_owned(),
                problem: "a cadence is a whole number of 5 s cycles"
            }
        );
    }
}

#[test]
fn only_a_register_or_a_computation_over_one_group_is_polled_in_a_group() {
    let topic = json!([{ "key": "t", "role": "extra.t", "topic": "t", "pollGroup": "slow" }]);
    let mixed = json!([
        { "key": "a", "role": "extra.a", "register": 1, "type": "u16" },
        { "key": "b", "role": "extra.b", "register": 2, "type": "u16", "pollGroup": "slow" },
        { "key": "c", "role": "extra.c", "compute": { "sum": ["a", "b"] } },
    ]);
    let named = json!([
        { "key": "a", "role": "extra.a", "register": 1, "type": "u16" },
        { "key": "c", "role": "extra.c", "compute": { "sum": ["a"] }, "pollGroup": "slow" },
    ]);
    let slow = json!({ "slow": 60 });

    assert_eq!(
        load(&slow, &topic).unwrap_err(),
        refused("t", "only a register is polled in a group")
    );
    assert_eq!(
        load(&slow, &mixed).unwrap_err(),
        refused("c", "a computation's inputs share one poll group")
    );
    assert_eq!(
        load(&slow, &named).unwrap_err(),
        refused("c", "a computed quantity polls with its inputs")
    );
}

#[test]
fn poll_groups_need_their_capability() {
    let doc = json!({
        "schema": 1, "id": "case", "name": "case", "manufacturer": "test", "version": "1.0.0",
        "requires": super::all_but("poll-group"), "pollGroups": { "slow": 60 },
        "quantities": [{ "key": "a", "role": "extra.a", "register": 1, "type": "u16",
                         "pollGroup": "slow" }],
    });

    assert_eq!(
        Profile::load(&doc.to_string()).unwrap_err(),
        LoadError::Unrequired("poll-group".to_owned())
    );
}
