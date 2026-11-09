//! A recipe run in its endpoint's task over `sim`: the capture is every byte the device sees, so a
//! retry or a stray request fails the replay.

use std::sync::Arc;
use std::time::Duration;

use serde_json::{Value, json};
use sunreye_profile::{Framing, Profile};

use super::{Applied, Job, Outcome};
use crate::bus::{Bus, DeviceId};
use crate::endpoint::{self, Device};
use crate::transport::{Capture, Endpoint, Exchange};

/// A device with no quantities, so its task polls nothing, and one setting with `recipe`.
fn job(setting: &Value, value: f64) -> (Device, Job) {
    let doc = json!({
        "schema": 1, "id": "case", "name": "case", "manufacturer": "test", "version": "1.0.0",
        "requires": ["modbus", "write"], "quantities": [], "settings": [setting],
    });
    let profile = Arc::new(Profile::load(&doc.to_string()).unwrap());
    let setting = profile.setting("current").unwrap().clone();
    let words = setting.encode(value).unwrap();
    let device = Device {
        id: DeviceId(1),
        unit: 1,
        profile,
    };
    (
        device,
        Job {
            unit: 1,
            setting,
            words,
        },
    )
}

fn current(recipe: &Value) -> Value {
    json!({
        "key": "current", "type": "u16", "range": { "min": 0, "max": 350 }, "minInterval": 60,
        "recipe": recipe, "readBack": { "register": 108 },
    })
}

fn frame(transaction: u16, pdu: &[u8]) -> Vec<u8> {
    let mut frame = transaction.to_be_bytes().to_vec();
    frame.extend_from_slice(&[0, 0]);
    frame.extend_from_slice(&u16::try_from(pdu.len() + 1).unwrap().to_be_bytes());
    frame.push(1);
    frame.extend_from_slice(pdu);
    frame
}

/// Unit 1 reads register `at` as `value`.
fn read(transaction: u16, at: u16, value: u16) -> [Exchange; 2] {
    let [a, b] = at.to_be_bytes();
    let [v, w] = value.to_be_bytes();
    [
        Exchange::Request(frame(transaction, &[3, a, b, 0, 1])),
        Exchange::Reply(vec![frame(transaction, &[3, 2, v, w])]),
    ]
}

/// Unit 1 is asked to write `value` to register `at`; `reply` is its PDU.
fn write(transaction: u16, at: u16, value: u16, reply: &[u8]) -> [Exchange; 2] {
    let [a, b] = at.to_be_bytes();
    let [v, w] = value.to_be_bytes();
    [
        Exchange::Request(frame(transaction, &[0x10, a, b, 0, 1, 2, v, w])),
        Exchange::Reply(vec![frame(transaction, reply)]),
    ]
}

fn echo(at: u16) -> Vec<u8> {
    let [a, b] = at.to_be_bytes();
    vec![0x10, a, b, 0, 1]
}

async fn run(device: Device, job: Job, exchanges: Vec<Exchange>) -> Applied {
    let endpoint = Endpoint::Sim(Capture {
        framing: Framing::Tcp,
        exchanges,
    });
    let task = endpoint::spawn(endpoint, vec![device], Bus::default());
    task.write(job).await.unwrap()
}

#[tokio::test(start_paused = true)]
async fn a_step_that_fails_after_an_earlier_write_is_partial_and_named() {
    let recipe = json!([{ "write": { "register": 108 } }, { "write": { "register": 109 } }]);
    let (device, job) = job(&current(&recipe), 50.0);
    let exchanges = [
        read(1, 108, 108),
        write(2, 108, 50, &echo(108)),
        // Exception 2: the device refuses register 109.
        write(3, 109, 50, &[0x90, 2]),
        read(4, 108, 50),
    ]
    .concat();

    let applied = run(device, job, exchanges).await;

    assert_eq!(
        applied,
        Applied {
            outcome: Outcome::Partial,
            before: Some(108.0),
            after: Some(50.0),
            failed_step: Some(2),
        }
    );
}

#[tokio::test(start_paused = true)]
async fn a_device_that_refuses_the_first_step_is_a_mismatch() {
    let recipe = json!([{ "write": { "register": 108 } }]);
    let (device, job) = job(&current(&recipe), 50.0);
    let exchanges = [
        read(1, 108, 108),
        write(2, 108, 50, &[0x90, 3]),
        read(3, 108, 108),
    ]
    .concat();

    let applied = run(device, job, exchanges).await;

    assert_eq!(
        applied,
        Applied {
            outcome: Outcome::Mismatch,
            before: Some(108.0),
            after: Some(108.0),
            failed_step: Some(1),
        }
    );
}

#[tokio::test(start_paused = true)]
async fn a_write_only_setting_is_written_unread_and_unknown() {
    let mut setting = current(&json!([{ "write": { "register": 108 } }]));
    setting.as_object_mut().unwrap().remove("readBack");
    setting["writeOnly"] = json!(true);
    let (device, job) = job(&setting, 50.0);

    let applied = run(device, job, write(1, 108, 50, &echo(108)).to_vec()).await;

    assert_eq!(
        applied,
        Applied {
            outcome: Outcome::Unknown,
            before: None,
            after: None,
            failed_step: None,
        }
    );
}

#[tokio::test(start_paused = true)]
async fn a_delay_holds_the_next_step_back() {
    let recipe = json!([
        { "write": { "register": 108 } },
        { "delay": { "ms": 500 } },
        { "write": { "register": 109 } },
    ]);
    let (device, job) = job(&current(&recipe), 50.0);
    let exchanges = [
        read(1, 108, 108),
        write(2, 108, 50, &echo(108)),
        write(3, 109, 50, &echo(109)),
        read(4, 108, 50),
    ]
    .concat();
    let start = tokio::time::Instant::now();

    let applied = run(device, job, exchanges).await;

    assert_eq!(applied.outcome, Outcome::Verified);
    assert!(start.elapsed() >= Duration::from_millis(500));
}

#[tokio::test(start_paused = true)]
async fn a_refusal_after_steps_that_wrote_nothing_is_a_mismatch() {
    let recipe = json!([{ "delay": { "ms": 500 } }, { "write": { "register": 108 } }]);
    let (device, job) = job(&current(&recipe), 50.0);
    let exchanges = [
        read(1, 108, 108),
        write(2, 108, 50, &[0x90, 3]),
        read(3, 108, 108),
    ]
    .concat();

    let applied = run(device, job, exchanges).await;

    assert_eq!(
        applied,
        Applied {
            outcome: Outcome::Mismatch,
            before: Some(108.0),
            after: Some(108.0),
            failed_step: Some(2),
        }
    );
}

#[tokio::test(start_paused = true)]
async fn a_block_write_sends_the_value_among_its_fixed_words_in_one_request() {
    let recipe = json!([{ "writeBlock": { "register": 107, "words": [1, "value", 9] } }]);
    let (device, job) = job(&current(&recipe), 50.0);
    let exchanges = [
        read(1, 108, 108),
        [
            Exchange::Request(frame(2, &[0x10, 0, 107, 0, 3, 6, 0, 1, 0, 50, 0, 9])),
            Exchange::Reply(vec![frame(2, &[0x10, 0, 107, 0, 3])]),
        ],
        read(3, 108, 50),
    ]
    .concat();

    let applied = run(device, job, exchanges).await;

    assert_eq!(applied.outcome, Outcome::Verified);
}
