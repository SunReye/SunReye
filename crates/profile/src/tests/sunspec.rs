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
use crate::{Profile, Registers};
use serde_json::{Value, json};

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

/// pysunspec's test inverter: a common model, a three-phase inverter (103) and an MPPT extension
/// (160) of three modules. Its file comments each register with the point it holds.
fn pysunspec_inverter() -> Device {
    let dump: Value =
        serde_json::from_str(include_str!("sunspec-pysunspec-inverter.json")).unwrap();
    let words: Vec<u16> = serde_json::from_value(dump["words"].clone()).unwrap();
    let start = u16::try_from(dump["start"].as_u64().unwrap()).unwrap();
    Device::default().with(start, &words)
}

/// A profile of SunSpec points: `register` counts from the model's ID, as the SunSpec model
/// definitions (`sunspec/models`, `json/model_<id>.json`) lay a model out.
fn points(quantities: &Value) -> Profile {
    let doc = json!({
        "schema": 1, "id": "sunspec", "name": "SunSpec", "manufacturer": "SunSpec", "version": "1.0.0",
        "requires": ["sunspec", "u16", "i16", "u32", "acc32", "scale-factor"],
        "quantities": quantities,
    });
    Profile::load(&doc.to_string()).unwrap()
}

/// Polls `device` once with `profile` bound to its chain, as the core does after connect.
fn poll(profile: &Profile, device: &Device) -> HashMap<String, Option<f64>> {
    let bound = profile.bind(&chain(device));
    let mut registers = Registers::default();
    for block in bound.read_plan(0) {
        registers.answer(block.start, &device.read(block.start, block.count).unwrap());
    }
    let mut values = vec![None; bound.quantities().len()];
    bound.decode(&registers, &mut values);
    bound
        .quantities()
        .iter()
        .map(|q| q.key.clone())
        .zip(values)
        .collect()
}

/// Expected values from the comments of `mbmap_test_inverter_2.xml`.
#[test]
fn a_point_reads_in_the_first_listed_model_of_the_chain_with_its_scale_factor() {
    let inverter = [101, 102, 103];
    let profile = points(&json!([
        { "key": "w", "role": "pv.power", "model": inverter, "register": 14, "type": "i16",
          "scaleFactor": 15, "resolution": 0.01 },
        { "key": "hz", "role": "grid.frequency", "model": inverter, "register": 16, "type": "u16",
          "scaleFactor": 17, "resolution": 0.001 },
        { "key": "wh", "role": "pv.energy.total", "model": inverter, "register": 24, "type": "acc32",
          "scale": 0.001, "scaleFactor": 26, "resolution": 0.000_001 },
        { "key": "dcv1", "role": "pv.mppt.voltage", "index": 1, "model": [160], "register": 20,
          "type": "u16", "scaleFactor": 3, "resolution": 0.01 },
        { "key": "dcw2", "role": "pv.mppt.power", "index": 2, "model": [160], "register": 41,
          "type": "u16", "scaleFactor": 4, "resolution": 0.01 },
        { "key": "dca3", "role": "pv.mppt.current", "index": 3, "model": [160], "register": 59,
          "type": "u16", "scaleFactor": 2, "resolution": 0.001 },
    ]));

    let values = poll(&profile, &pysunspec_inverter());

    assert_eq!(values["w"], Some(2970.0));
    assert_eq!(values["hz"], Some(59.99));
    assert_eq!(values["wh"], Some(1234.567));
    assert_eq!(values["dcv1"], Some(300.11));
    assert_eq!(values["dcw2"], Some(332.0));
    assert_eq!(values["dca3"], Some(1.3));
}

/// A point of a model the chain lacks, or past the end of its model, such as a fourth MPPT
/// module of three, is never read.
#[test]
fn a_point_outside_the_chain_has_no_value() {
    let profile = points(&json!([
        { "key": "dcw4", "role": "pv.mppt.power", "index": 4, "model": [160], "register": 71,
          "type": "u16", "scaleFactor": 4, "resolution": 0.01 },
        { "key": "soc", "role": "battery.soc", "model": [802], "register": 11, "type": "u16" },
    ]));

    let values = poll(&profile, &pysunspec_inverter());

    assert_eq!(values["dcw4"], None);
    assert_eq!(values["soc"], None);
}

/// Unimplemented points hold their type's sentinel (SunSpec Information Model Specification;
/// pysunspec2 `sunspec2/mb.py` `SUNS_UNIMPL_*` at commit bbe9e044): `int16` 0x8000, `uint16` 0xFFFF, `acc32` 0,
/// `uint32` 0xFFFFFFFF; a `sunssf` of 0x8000 leaves its points without a scale.
#[test]
fn a_sentinel_reads_as_no_value() {
    let mut words = MARKER.to_vec();
    words.extend([1, 0, 64000, 9]);
    words.extend([0x8000, 0xFFFF, 0, 0, 0xFFFF, 0xFFFF, 0x8000, 42, 7]);
    words.extend([END, 0]);
    let device = Device::default().with(40000, &words);
    let model = [64000];
    let profile = points(&json!([
        { "key": "i16", "role": "extra.a", "model": model, "register": 2, "type": "i16" },
        { "key": "u16", "role": "extra.b", "model": model, "register": 3, "type": "u16" },
        { "key": "acc32", "role": "extra.c", "model": model, "register": 4, "type": "acc32" },
        { "key": "u32", "role": "extra.d", "model": model, "register": 6, "type": "u32" },
        { "key": "unscaled", "role": "extra.e", "model": model, "register": 9, "type": "u16",
          "scaleFactor": 8, "resolution": 1 },
        { "key": "read", "role": "extra.f", "model": model, "register": 10, "type": "u16" },
    ]));

    let values = poll(&profile, &device);

    for key in ["i16", "u16", "acc32", "u32", "unscaled"] {
        assert_eq!(values[key], None, "{key}");
    }
    assert_eq!(values["read"], Some(7.0));
}

/// Before discovery a SunSpec profile reads nothing: its plan compiles at connect.
#[test]
fn the_plan_of_a_sunspec_profile_is_the_chain_it_is_bound_to() {
    let profile = points(&json!([
        { "key": "w", "role": "pv.power", "model": [103], "register": 14, "type": "i16" },
    ]));
    let device = pysunspec_inverter();

    assert!(profile.reads_sunspec());
    assert_eq!(profile.read_plan(0), []);
    assert_eq!(
        profile.bind(&chain(&device)).read_plan(32),
        chain(&device).read_plan(32)
    );
}

/// A device that refuses the merged read with exception 2 gets each model's registers apart.
#[test]
fn a_refused_merged_block_splits_into_the_models_registers() {
    let device = pysunspec_inverter();
    let bound = points(&json!([
        { "key": "w", "role": "pv.power", "model": [103], "register": 14, "type": "i16" },
    ]))
    .bind(&chain(&device));

    let merged = bound.read_plan(32);

    assert_eq!(merged, [block(40004, 118, true), block(40124, 68, false)]);
    assert_eq!(
        bound.split(block(40004, 118, true)),
        [block(40004, 66, false), block(40072, 50, false)]
    );
}
