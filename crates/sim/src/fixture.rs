//! Readers for the two oracle files the simulator replays.

use std::collections::BTreeMap;
use std::path::Path;

use serde::Deserialize;

use crate::server::crc16;

#[derive(Debug, thiserror::Error)]
pub enum FixtureError {
    #[error("cannot read fixtures: {0}")]
    Io(#[from] std::io::Error),
    #[error("malformed fixture: {0}")]
    Json(#[from] serde_json::Error),
    #[error("no fixture for {0}")]
    Missing(String),
    #[error("not a Modbus TCP frame: {0}")]
    BadFrame(String),
}

/// Holding registers a device answers. A read touching an unmapped register is refused.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Registers(BTreeMap<u16, u16>);

impl Registers {
    pub fn from_runs(runs: impl IntoIterator<Item = (u16, Vec<u16>)>) -> Self {
        let words = runs.into_iter().flat_map(|(start, words)| {
            words.into_iter().enumerate().filter_map(move |(offset, word)| {
                Some((u16::try_from(usize::from(start) + offset).ok()?, word))
            })
        });
        Self(words.collect())
    }

    /// The `count` words from `start`; `None` when any of them is unmapped.
    pub fn read(&self, start: u16, count: u16) -> Option<Vec<u16>> {
        let first = u32::from(start);
        (first..first + u32::from(count))
            .map(|addr| u16::try_from(addr).ok().and_then(|addr| self.0.get(&addr).copied()))
            .collect()
    }
}

/// One case of the profile-decode corpus: the registers a profile's device answers and what the
/// 2.x engine decoded from them.
#[derive(Debug, Clone)]
pub struct ProfileCase {
    pub registers: Registers,
    pub readings: BTreeMap<String, f64>,
}

#[derive(Deserialize)]
struct ProfileRow {
    profile: ProfileId,
    cases: Vec<CaseRow>,
}

#[derive(Deserialize)]
struct ProfileId {
    id: String,
}

#[derive(Deserialize)]
struct CaseRow {
    name: String,
    runs: Vec<Run>,
    readings: BTreeMap<String, f64>,
}

#[derive(Deserialize)]
struct Run {
    start: u16,
    words: Vec<u16>,
}

pub fn profile_case(dir: &Path, profile_id: &str, case: &str) -> Result<ProfileCase, FixtureError> {
    let text = std::fs::read_to_string(dir.join("profile-decode.ndjson"))?;
    for line in text.lines() {
        let row: ProfileRow = serde_json::from_str(line)?;
        if row.profile.id != profile_id {
            continue;
        }
        let found = row.cases.into_iter().find(|c| c.name == case);
        return found
            .map(|c| ProfileCase {
                registers: Registers::from_runs(c.runs.into_iter().map(|r| (r.start, r.words))),
                readings: c.readings,
            })
            .ok_or_else(|| FixtureError::Missing(format!("{profile_id}/{case}")));
    }
    Err(FixtureError::Missing(format!("profile {profile_id}")))
}

/// One step of a recorded wire exchange.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Exchange {
    /// Bytes the client must send.
    Expect(Vec<u8>),
    /// A reply, one entry per TCP write.
    Send(Vec<Vec<u8>>),
}

#[derive(Deserialize)]
#[serde(tag = "dir", rename_all = "lowercase")]
enum ExchangeRow {
    Tx { hex: String },
    Rx { chunks: Vec<String> },
}

/// A metric as the transport corpus writes it; `compute_sum` makes it a computed sum.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FixtureMetric {
    pub key: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub addr: Vec<u16>,
    pub scale: f64,
    pub compute_sum: Option<Vec<String>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TransportRow {
    case: String,
    framing: String,
    unit_id: u8,
    metrics: Vec<FixtureMetric>,
    exchanges: Vec<ExchangeRow>,
    result: serde_json::Value,
    logger_serial: Option<u32>,
    configured_serial: Option<u32>,
}

/// One case of the transport corpus.
#[derive(Debug, Clone)]
pub struct TransportCase {
    pub name: String,
    pub unit_id: u8,
    pub metrics: Vec<FixtureMetric>,
    pub exchanges: Vec<Exchange>,
    /// What 2.x returned: `{values}`, `{error}`, `{written}` or `{probe}`.
    pub result: serde_json::Value,
    /// The stick's own serial; `solarman-v5` cases only.
    pub logger_serial: Option<u32>,
    /// The serial the client was configured with, when the case configures one.
    pub configured_serial: Option<u32>,
}

/// Every case of `framing` (`tcp`, `rtu-over-tcp`, `solarman-v5`).
pub fn transport_cases(dir: &Path, framing: &str) -> Result<Vec<TransportCase>, FixtureError> {
    let text = std::fs::read_to_string(dir.join("transport.ndjson"))?;
    let mut cases = Vec::new();
    for line in text.lines() {
        let row: TransportRow = serde_json::from_str(line)?;
        if row.framing != framing {
            continue;
        }
        let exchanges = row.exchanges.into_iter().map(exchange).collect::<Result<_, _>>()?;
        cases.push(TransportCase {
            name: row.case,
            unit_id: row.unit_id,
            metrics: row.metrics,
            exchanges,
            result: row.result,
            logger_serial: row.logger_serial,
            configured_serial: row.configured_serial,
        });
    }
    Ok(cases)
}

/// Every `rtu-over-tcp` case with its wire bytes re-framed as RTU. The corpus recorded 2.x writing MBAP
/// frames on that transport (`fixtures/oracle/README.md`); PDUs, registers and decoded values carry over,
/// the bytes around them become unit id, PDU and CRC; stray bytes before a reply stay as recorded.
pub fn rtu_cases(dir: &Path) -> Result<Vec<TransportCase>, FixtureError> {
    let mut cases = transport_cases(dir, "rtu-over-tcp")?;
    for case in &mut cases {
        case.exchanges = case.exchanges.iter().map(reframe).collect::<Result<_, _>>()?;
    }
    Ok(cases)
}

fn reframe(step: &Exchange) -> Result<Exchange, FixtureError> {
    Ok(match step {
        Exchange::Expect(mbap) => Exchange::Expect(mbap_to_rtu(mbap)?),
        Exchange::Send(chunks) => {
            let wire = chunks.concat();
            let framed = (0..wire.len())
                .find_map(|junk| Some([&wire[..junk], &mbap_to_rtu(&wire[junk..]).ok()?].concat()))
                .ok_or_else(|| FixtureError::BadFrame(format!("{wire:02x?}")))?;
            Exchange::Send(resplit(&framed, chunks))
        }
    })
}

/// `bytes` cut at the same lengths as `chunks`, as far as it reaches.
fn resplit(bytes: &[u8], chunks: &[Vec<u8>]) -> Vec<Vec<u8>> {
    let mut rest = bytes;
    let mut out = Vec::new();
    for chunk in &chunks[..chunks.len() - 1] {
        let (head, tail) = rest.split_at(chunk.len().min(rest.len()));
        out.push(head.to_vec());
        rest = tail;
    }
    out.push(rest.to_vec());
    out.retain(|chunk| !chunk.is_empty());
    out
}

/// Each MBAP frame in `bytes` becomes unit id, PDU, CRC-16/Modbus (low byte first).
fn mbap_to_rtu(bytes: &[u8]) -> Result<Vec<u8>, FixtureError> {
    let mut out = Vec::new();
    let mut rest = bytes;
    while !rest.is_empty() {
        let bad = || FixtureError::BadFrame(format!("{rest:02x?}"));
        if rest.get(2..4) != Some(&[0, 0]) {
            return Err(bad());
        }
        let length = rest.get(4..6).map(|b| usize::from(u16::from_be_bytes([b[0], b[1]]))).ok_or_else(bad)?;
        let frame = rest.get(6..6 + length).ok_or_else(bad)?;
        out.extend_from_slice(frame);
        out.extend_from_slice(&crc16(frame).to_le_bytes());
        rest = &rest[6 + length..];
    }
    Ok(out)
}

fn exchange(row: ExchangeRow) -> Result<Exchange, FixtureError> {
    Ok(match row {
        ExchangeRow::Tx { hex } => Exchange::Expect(unhex(&hex)?),
        ExchangeRow::Rx { chunks } => {
            Exchange::Send(chunks.iter().map(|c| unhex(c)).collect::<Result<_, _>>()?)
        }
    })
}

fn unhex(hex: &str) -> Result<Vec<u8>, FixtureError> {
    let bad = || FixtureError::Missing(format!("hex string {hex:?}"));
    if !hex.len().is_multiple_of(2) {
        return Err(bad());
    }
    hex.as_bytes()
        .chunks(2)
        .map(|pair| {
            let pair = std::str::from_utf8(pair).map_err(|_| bad())?;
            u8::from_str_radix(pair, 16).map_err(|_| bad())
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registers_read_a_mapped_range() {
        let registers = Registers::from_runs([(10, vec![1, 2, 3]), (20, vec![9])]);
        assert_eq!(registers.read(10, 3), Some(vec![1, 2, 3]));
        assert_eq!(registers.read(11, 1), Some(vec![2]));
        assert_eq!(registers.read(20, 1), Some(vec![9]));
    }

    #[test]
    fn registers_refuse_a_range_with_a_hole_or_past_the_end_of_the_address_space() {
        let registers = Registers::from_runs([(10, vec![1]), (12, vec![3]), (65535, vec![7])]);
        assert_eq!(registers.read(10, 3), None);
        assert_eq!(registers.read(65535, 1), Some(vec![7]));
        assert_eq!(registers.read(65535, 2), None);
        assert_eq!(registers.read(0, 0), Some(vec![]));
        assert_eq!(Registers::from_runs([(65535, vec![1, 2])]).read(65535, 1), Some(vec![1]));
    }

    #[test]
    fn hex_decodes_pairs_and_refuses_the_rest() {
        assert_eq!(unhex("00ff10").ok(), Some(vec![0, 255, 16]));
        assert_eq!(unhex("").ok(), Some(vec![]));
        assert!(unhex("0g").is_err());
        assert!(unhex("abc").is_err());
    }

    #[test]
    fn an_mbap_frame_becomes_unit_pdu_and_crc_and_a_malformed_one_is_refused() {
        let mbap = [0, 1, 0, 0, 0, 6, 1, 3, 0, 0, 0, 10];
        assert_eq!(mbap_to_rtu(&mbap).ok(), Some(vec![1, 3, 0, 0, 0, 10, 0xc5, 0xcd]));
        let two = [mbap.as_slice(), mbap.as_slice()].concat();
        assert_eq!(mbap_to_rtu(&two).ok().map(|rtu| rtu.len()), Some(16), "frames follow one another");
        assert_eq!(mbap_to_rtu(&[]).ok(), Some(vec![]));
        assert!(mbap_to_rtu(&mbap[..11]).is_err(), "a frame shorter than its length field");
        assert!(mbap_to_rtu(&mbap[..5]).is_err(), "a header cut short");
    }

    #[test]
    fn stray_bytes_before_a_recorded_reply_stay_in_front_of_the_reframed_one() {
        let mbap = [0, 1, 0, 0, 0, 6, 1, 3, 0, 0, 0, 10];
        let rtu = vec![1, 3, 0, 0, 0, 10, 0xc5, 0xcd];
        let step = |bytes: Vec<u8>| reframe(&Exchange::Send(vec![bytes])).ok();
        assert_eq!(step(mbap.to_vec()), Some(Exchange::Send(vec![rtu.clone()])));
        let junk = [0xde, 0xad, 0xbe];
        assert_eq!(
            step([junk.as_slice(), &mbap].concat()),
            Some(Exchange::Send(vec![[&junk[..], &rtu].concat()]))
        );
        assert_eq!(step(junk.to_vec()), None, "stray bytes and no frame");
        assert_eq!(step([0, 1, 0, 9, 0, 6, 1, 3, 0, 0, 0, 10].to_vec()), None, "not the Modbus protocol id");
    }

    #[test]
    fn a_reply_is_cut_at_the_recorded_lengths_as_far_as_the_frame_reaches() {
        let chunks = [vec![0; 5], vec![0; 20]];
        let cut = resplit(&[1, 2, 3, 4, 5, 6, 7], &chunks);
        assert_eq!(cut, [vec![1, 2, 3, 4, 5], vec![6, 7]]);
        assert_eq!(resplit(&[1, 2, 3], &chunks), [vec![1, 2, 3]], "no empty chunk");
        assert_eq!(resplit(&[1, 2], &[vec![0]]), [vec![1, 2]]);
    }
}
