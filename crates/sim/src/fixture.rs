//! Readers for the two oracle files the simulator replays.

use std::collections::BTreeMap;
use std::path::Path;

use serde::Deserialize;

#[derive(Debug, thiserror::Error)]
pub enum FixtureError {
    #[error("cannot read fixtures: {0}")]
    Io(#[from] std::io::Error),
    #[error("malformed fixture: {0}")]
    Json(#[from] serde_json::Error),
    #[error("no fixture for {0}")]
    Missing(String),
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
        });
    }
    Ok(cases)
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
}
