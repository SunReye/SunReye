//! SunSpec discovery (ADR 5), driven against register maps.
//!
//! The facts under test are the SunSpec Information Model Specification's (SunSpec Alliance,
//! document 12041): a map starts at register 40001, 50001 or 1 (protocol addresses 40000, 50000
//! and 0) with the marker `SunS` (0x53756e53) in two registers; each model is a header, its ID
//! and its length `L` in registers after the header, then `L` registers; model ID 0xFFFF ends the
//! chain. They are checked against the Alliance's reference client, pysunspec2
//! (`sunspec2/modbus/client.py`, `SunSpecModbusClientDevice.scan`, and `sunspec2/mdef.py`
//! `END_MODEL_ID = 65535`, at commit bbe9e044), which also reads an end model that has no length.

use std::collections::HashMap;

use crate::sunspec::{Discovery, Model, Next};
use crate::{Block, Framing};
use serde_json::Value;

/// `SunS`, high word first.
const MARKER: [u16; 2] = [0x5375, 0x6e53];
const END: u16 = 0xFFFF;

/// A device's holding registers; a read of any register outside them is refused.
#[derive(Default)]
struct Device(HashMap<u16, u16>);

impl Device {
    fn with(mut self, start: u16, words: &[u16]) -> Self {
        self.0.extend((start..).zip(words.iter().copied()));
        self
    }

    fn read(&self, start: u16, count: u16) -> Option<Vec<u16>> {
        (start..start + count)
            .map(|a| self.0.get(&a).copied())
            .collect()
    }
}

/// Runs discovery against `device`; returns its outcome and every read it asked for.
fn discover(device: &Device) -> (Next, Vec<(u16, u16)>) {
    let mut discovery = Discovery::new();
    let mut reads = Vec::new();
    loop {
        match discovery.next() {
            Next::Read { start, count } => {
                reads.push((start, count));
                assert!(reads.len() < 100, "discovery does not end");
                discovery.answer(device.read(start, count).as_deref());
            }
            done @ (Next::Found(_) | Next::Absent) => return (done, reads),
        }
    }
}

/// A map at `base`: the marker, a common model of `L` 4, an inverter model 103 of `L` 6, the end.
fn inverter(base: u16) -> Device {
    let mut words = MARKER.to_vec();
    words.extend([1, 4, 0, 0, 0, 0]);
    words.extend([103, 6, 0, 0, 0, 0, 0, 0]);
    words.extend([END, 0]);
    Device::default().with(base, &words)
}

fn models(next: &Next) -> Vec<Model> {
    match next {
        Next::Found(chain) => chain.models().to_vec(),
        Next::Read { .. } | Next::Absent => panic!("not found: {next:?}"),
    }
}

#[test]
fn the_base_search_tries_40001_then_50001_then_1() {
    let (next, reads) = discover(&Device::default());

    assert!(matches!(next, Next::Absent), "{next:?}");
    assert_eq!(reads, [(40000, 2), (50000, 2), (0, 2)]);
}

#[test]
fn the_first_base_that_holds_the_marker_is_the_one_walked() {
    let bases = [40000, 50000, 0];
    for (tried, base) in bases.into_iter().enumerate() {
        let (next, reads) = discover(&inverter(base));

        assert_eq!(
            models(&next).first().map(|m| (m.id, m.start)),
            Some((1, base + 4))
        );
        let searched: Vec<(u16, u16)> = bases.iter().take(tried + 1).map(|b| (*b, 2)).collect();
        assert_eq!(
            reads.get(..=tried),
            Some(searched.as_slice()),
            "base {base}"
        );
    }
}

#[test]
fn a_base_that_answers_without_the_marker_is_passed_over() {
    let device = inverter(0)
        .with(40000, &[0x5375, 0x6e54])
        .with(50000, &[0, 0]);

    let (next, _) = discover(&device);

    assert_eq!(models(&next).len(), 2);
}

#[test]
fn the_chain_is_walked_to_the_end_model() {
    let (next, reads) = discover(&inverter(40000));

    let walked = [
        Model {
            id: 1,
            start: 40004,
            length: 4,
        },
        Model {
            id: 103,
            start: 40010,
            length: 6,
        },
    ];
    assert_eq!(models(&next), walked);
    assert_eq!(reads, [(40000, 2), (40002, 2), (40008, 2), (40016, 2)]);
}

/// The dump pysunspec2 scans in its own client test: a common model and a model 126, and an end
/// model with no length after it, the device's last register.
#[test]
fn a_public_dump_walks_to_an_end_model_without_a_length() {
    let dump: Value = serde_json::from_str(include_str!("sunspec-pysunspec2.json")).unwrap();
    let words: Vec<u16> = serde_json::from_value(dump["words"].clone()).unwrap();
    let start = u16::try_from(dump["start"].as_u64().unwrap()).unwrap();

    let (next, reads) = discover(&Device::default().with(start, &words));

    let walked = [
        Model {
            id: 1,
            start: 40004,
            length: 66,
        },
        Model {
            id: 126,
            start: 40072,
            length: 64,
        },
    ];
    assert_eq!(models(&next), walked);
    assert_eq!(reads.last(), Some(&(40136, 1)));
}

#[test]
fn a_chain_that_breaks_before_the_end_model_is_absent() {
    let unended = Device::default().with(40000, &[MARKER[0], MARKER[1], 1, 4, 0, 0, 0, 0]);
    let wrapping = Device::default().with(50000, &[MARKER[0], MARKER[1], 1, 20000]);

    for device in [unended, wrapping] {
        let (next, _) = discover(&device);
        assert_eq!(next, Next::Absent);
    }
}

fn block(start: u16, count: u16, merged: bool) -> Block {
    Block {
        start,
        count,
        grouped: false,
        merged,
    }
}

fn chain(device: &Device) -> crate::sunspec::Chain {
    match discover(device).0 {
        Next::Found(chain) => chain,
        next @ (Next::Read { .. } | Next::Absent) => panic!("not found: {next:?}"),
    }
}

/// The plan reads every model's registers, not its header, in blocks a request can carry.
#[test]
fn the_read_plan_compiled_at_connect_reads_each_model() {
    let chain = chain(&inverter(40000));

    let tcp = chain.read_plan(Framing::Tcp.gap_tolerance());
    let solarman = chain.read_plan(Framing::SolarmanV5.gap_tolerance());

    assert_eq!(tcp, [block(40004, 4, false), block(40010, 6, false)]);
    assert_eq!(solarman, [block(40004, 12, true)]);
}

#[test]
fn a_model_longer_than_one_request_is_read_in_several_and_an_empty_one_not_at_all() {
    let mut words = MARKER.to_vec();
    words.extend([1, 0, 160, 200]);
    words.extend([0; 200]);
    words.push(END);
    let chain = chain(&Device::default().with(40000, &words));

    assert_eq!(
        chain.read_plan(0),
        [block(40006, 120, false), block(40126, 80, false)]
    );
}

/// The identify probe's variant is the device model that follows the common model (1), such as
/// an inverter's 101, 102 or 103 by phases.
#[test]
fn the_variant_is_the_model_after_the_common_model() {
    let alone = Device::default().with(0, &[MARKER[0], MARKER[1], 1, 0, END]);
    let headless = Device::default().with(0, &[MARKER[0], MARKER[1], 103, 0, END]);

    assert_eq!(chain(&inverter(40000)).variant(), Some(103));
    assert_eq!(chain(&alone).variant(), None);
    assert_eq!(chain(&headless).variant(), None);
}
