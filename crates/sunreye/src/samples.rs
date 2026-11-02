//! The per-minute sample encoding, version 1.
//!
//! A reading row holds one minute of one device: every sample polled in that minute, as a blob.
//! Metric keys are not in the blob; they are interned in the `metric` table and the blob carries ids.
//!
//! ```text
//! blob     = version:u8(=1) n_samples:uvarint offset*n_samples n_metrics:uvarint column*n_metrics
//! offset   = uvarint, milliseconds since the start of the minute, 0..60000
//! column   = metric_id:uvarint cell*n_samples        (columns ascend by metric id)
//! cell     = 0x00                    the sample has no value for this metric
//!          | 0x01                    the same value as the last present cell of this column
//!          | 0x02 f64:8 bytes LE     a value, every bit kept
//! uvarint  = LEB128, 7 bits per byte, low group first, at most 10 bytes
//! ```
//!
//! A steady metric costs one byte per sample after its first value. A power cut loses at most the
//! minute in progress, because a row is written when its minute closes ([`Unstored`]).

use std::collections::{BTreeMap, BTreeSet};
use std::sync::{Mutex, MutexGuard, PoisonError};

pub const MINUTE_MS: i64 = 60_000;
const VERSION: u8 = 1;
const ABSENT: u8 = 0;
const REPEAT: u8 = 1;
const VALUE: u8 = 2;

/// One poll of one device: when it was taken and what the profile decoded from it.
#[derive(Debug, Clone, PartialEq)]
pub struct Sample {
    /// Unix milliseconds.
    pub at_ms: i64,
    pub values: Vec<(String, f64)>,
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum SampleError {
    #[error("sample at {at_ms} ms is outside its minute")]
    OutsideMinute { at_ms: i64 },
    #[error("metric {0:?} has no id")]
    UnknownMetric(String),
    #[error("metric id {0} has no key")]
    UnknownId(u32),
    #[error("corrupt minute blob: {0}")]
    Corrupt(&'static str),
}

/// The minute a timestamp falls in, counted from the Unix epoch; floors toward the past.
pub fn minute_of(at_ms: i64) -> i64 {
    at_ms.div_euclid(MINUTE_MS)
}

pub fn encode(minute: i64, samples: &[Sample], ids: &BTreeMap<String, u32>) -> Result<Vec<u8>, SampleError> {
    let mut rows = Vec::with_capacity(samples.len());
    let mut metrics = BTreeSet::new();
    let mut out = vec![VERSION];
    put_uvarint(&mut out, samples.len() as u64);
    for sample in samples {
        let offset = sample.at_ms - minute * MINUTE_MS;
        if !(0..MINUTE_MS).contains(&offset) {
            return Err(SampleError::OutsideMinute { at_ms: sample.at_ms });
        }
        put_uvarint(&mut out, offset.unsigned_abs());
        let mut row = BTreeMap::new();
        for (key, value) in &sample.values {
            let id = *ids.get(key).ok_or_else(|| SampleError::UnknownMetric(key.clone()))?;
            metrics.insert(id);
            row.insert(id, *value);
        }
        rows.push(row);
    }
    put_uvarint(&mut out, metrics.len() as u64);
    for id in metrics {
        put_uvarint(&mut out, u64::from(id));
        let mut last: Option<f64> = None;
        for row in &rows {
            match row.get(&id) {
                None => out.push(ABSENT),
                Some(value) if last.is_some_and(|l| l.to_bits() == value.to_bits()) => out.push(REPEAT),
                Some(value) => {
                    out.push(VALUE);
                    out.extend_from_slice(&value.to_le_bytes());
                    last = Some(*value);
                }
            }
        }
    }
    Ok(out)
}

pub fn decode(minute: i64, blob: &[u8], keys: &BTreeMap<u32, String>) -> Result<Vec<Sample>, SampleError> {
    let mut reader = Reader { rest: blob };
    match reader.byte() {
        Err(_) => return Err(SampleError::Corrupt("empty")),
        Ok(VERSION) => {}
        Ok(_) => return Err(SampleError::Corrupt("unknown version")),
    }
    let count = reader.count()?;
    let mut samples = Vec::with_capacity(count);
    for _ in 0..count {
        let offset = i64::try_from(reader.uvarint()?)
            .map_err(|_| SampleError::Corrupt("offset outside the minute"))?;
        if offset >= MINUTE_MS {
            return Err(SampleError::Corrupt("offset outside the minute"));
        }
        samples.push(Sample { at_ms: minute * MINUTE_MS + offset, values: Vec::new() });
    }
    for _ in 0..reader.count()? {
        let id = u32::try_from(reader.uvarint()?).map_err(|_| SampleError::Corrupt("metric id too large"))?;
        let key = keys.get(&id).ok_or(SampleError::UnknownId(id))?;
        let mut last = None;
        for sample in &mut samples {
            match reader.byte()? {
                ABSENT => {}
                REPEAT => sample
                    .values
                    .push((key.clone(), last.ok_or(SampleError::Corrupt("repeat without a value"))?)),
                VALUE => {
                    let value = f64::from_le_bytes(reader.take()?);
                    last = Some(value);
                    sample.values.push((key.clone(), value));
                }
                _ => return Err(SampleError::Corrupt("unknown cell tag")),
            }
        }
    }
    Ok(samples)
}

fn put_uvarint(out: &mut Vec<u8>, mut value: u64) {
    while value >= 0x80 {
        let [low, ..] = value.to_le_bytes();
        out.push(low & 0x7f | 0x80);
        value >>= 7;
    }
    let [low, ..] = value.to_le_bytes();
    out.push(low);
}

struct Reader<'a> {
    rest: &'a [u8],
}

impl Reader<'_> {
    fn byte(&mut self) -> Result<u8, SampleError> {
        let [byte] = self.take::<1>()?;
        Ok(byte)
    }

    fn take<const N: usize>(&mut self) -> Result<[u8; N], SampleError> {
        let (head, rest) = self.rest.split_first_chunk::<N>().ok_or(SampleError::Corrupt("truncated"))?;
        self.rest = rest;
        Ok(*head)
    }

    fn uvarint(&mut self) -> Result<u64, SampleError> {
        let mut value = 0_u64;
        for group in 0..10 {
            let byte = self.byte()?;
            if group == 9 && byte > 1 {
                break;
            }
            value |= u64::from(byte & 0x7f) << (7 * group);
            if byte < 0x80 {
                return Ok(value);
            }
        }
        Err(SampleError::Corrupt("varint overflow"))
    }

    /// A count of items that each take at least one byte, so it cannot exceed what is left.
    fn count(&mut self) -> Result<usize, SampleError> {
        let count = self.uvarint()?;
        usize::try_from(count)
            .ok()
            .filter(|count| *count <= self.rest.len())
            .ok_or(SampleError::Corrupt("count exceeds the blob"))
    }
}

/// A minute of samples that has ended.
#[derive(Debug, Clone, PartialEq)]
pub struct ClosedMinute {
    pub minute: i64,
    pub samples: Vec<Sample>,
}

/// Each device's readings polled but not yet stored: the open minute, and a closed minute until its row
/// is written. Shared by the device tasks and the readers, so a reader never misses a reading between
/// the poll and the write.
#[derive(Debug, Default)]
pub struct Unstored {
    held: Mutex<BTreeMap<i64, Vec<Sample>>>,
}

impl Unstored {
    fn lock(&self) -> MutexGuard<'_, BTreeMap<i64, Vec<Sample>>> {
        self.held.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Holds `sample`; returns the minute it closes, which stays held until [`Unstored::release`].
    pub fn push(&self, device_id: i64, sample: Sample) -> Option<ClosedMinute> {
        let mut held = self.lock();
        let samples = held.entry(device_id).or_default();
        let closed = match samples.last() {
            Some(last) if minute_of(last.at_ms) != minute_of(sample.at_ms) => {
                Some(minute_in(samples, minute_of(last.at_ms)))
            }
            _ => None,
        };
        samples.push(sample);
        closed
    }

    /// The device's newest held minute, for storing when its task stops; holds it until released.
    pub fn newest(&self, device_id: i64) -> Option<ClosedMinute> {
        let held = self.lock();
        let samples = held.get(&device_id)?;
        Some(minute_in(samples, minute_of(samples.last()?.at_ms)))
    }

    /// The device's held readings, oldest first; a copy, at most two minutes of them.
    pub fn held(&self, device_id: i64) -> Vec<Sample> {
        self.lock().get(&device_id).cloned().unwrap_or_default()
    }

    /// Drops the device's readings of `minute`, once its row is written or the write failed.
    pub fn release(&self, device_id: i64, minute: i64) {
        let mut held = self.lock();
        if let Some(samples) = held.get_mut(&device_id) {
            samples.retain(|sample| minute_of(sample.at_ms) != minute);
            if samples.is_empty() {
                held.remove(&device_id);
            }
        }
    }
}

#[cfg(test)]
impl Unstored {
    /// The held map under its lock, so a test can write and release between a reader's two reads.
    pub(crate) fn hold(&self) -> MutexGuard<'_, BTreeMap<i64, Vec<Sample>>> {
        self.lock()
    }
}

fn minute_in(samples: &[Sample], minute: i64) -> ClosedMinute {
    let samples = samples.iter().filter(|s| minute_of(s.at_ms) == minute).cloned().collect();
    ClosedMinute { minute, samples }
}

/// `stored`, oldest first, then the `held` readings newer than all of them, so a minute both written and
/// still held reads once.
pub fn with_unstored(
    stored: impl IntoIterator<Item = Result<Sample, SampleError>>,
    held: Vec<Sample>,
) -> impl Iterator<Item = Result<Sample, SampleError>> {
    let mut newest = i64::MIN;
    let mut held = held.into_iter();
    let mut stored = stored.into_iter();
    std::iter::from_fn(move || {
        if let Some(next) = stored.next() {
            if let Ok(sample) = &next {
                newest = newest.max(sample.at_ms);
            }
            return Some(next);
        }
        held.find(|sample| sample.at_ms > newest).map(Ok)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const MINUTE: i64 = 29_000_000;

    fn at(offset_ms: i64, values: &[(&str, f64)]) -> Sample {
        Sample {
            at_ms: MINUTE * MINUTE_MS + offset_ms,
            values: values.iter().map(|(k, v)| ((*k).to_owned(), *v)).collect(),
        }
    }

    fn ids() -> BTreeMap<String, u32> {
        [("a", 1), ("b", 2), ("c", 300)].iter().map(|(k, id)| ((*k).to_owned(), *id)).collect()
    }

    fn keys() -> BTreeMap<u32, String> {
        ids().into_iter().map(|(k, id)| (id, k)).collect()
    }

    fn round_trip(samples: &[Sample]) -> Vec<Sample> {
        let blob = encode(MINUTE, samples, &ids()).expect("encode");
        decode(MINUTE, &blob, &keys()).expect("decode")
    }

    #[test]
    fn a_minute_of_samples_reads_back_exactly() {
        let samples = vec![
            at(0, &[("a", 230.5), ("b", -1000.0)]),
            at(5_000, &[("a", 230.5), ("b", -999.0)]),
            at(59_999, &[("a", 231.0), ("b", -999.0), ("c", 7.0)]),
        ];
        let back = round_trip(&samples);
        assert_eq!(back.len(), 3);
        for (got, want) in back.iter().zip(&samples) {
            assert_eq!(got.at_ms, want.at_ms);
            let mut sorted = got.values.clone();
            sorted.sort_by(|x, y| x.0.cmp(&y.0));
            assert_eq!(sorted, want.values);
        }
    }

    #[test]
    fn a_metric_absent_from_some_samples_stays_absent() {
        let back = round_trip(&[at(0, &[("a", 1.0)]), at(1, &[("b", 2.0)]), at(2, &[("a", 1.0)])]);
        assert_eq!(back[0].values, [("a".to_owned(), 1.0)]);
        assert_eq!(back[1].values, [("b".to_owned(), 2.0)]);
        assert_eq!(back[2].values, [("a".to_owned(), 1.0)]);
    }

    #[test]
    fn floats_keep_every_bit() {
        let tricky =
            [-0.0, 0.0, f64::MIN_POSITIVE / 2.0, f64::MAX, f64::MIN, 0.1 + 0.2, -20.699_999_999_999_99];
        let samples: Vec<Sample> = tricky.iter().map(|v| at(0, &[("a", *v)])).collect();
        let back = round_trip(&samples);
        for (got, want) in back.iter().zip(tricky) {
            assert_eq!(got.values[0].1.to_bits(), want.to_bits());
        }
    }

    #[test]
    fn a_steady_reading_costs_one_byte_per_repeat() {
        let steady: Vec<Sample> = (0..12).map(|i| at(i * 1_000, &[("a", 1234.5)])).collect();
        let blob = encode(MINUTE, &steady, &ids()).expect("encode");
        let first = encode(MINUTE, &steady[..1], &ids()).expect("encode");
        assert_eq!(
            blob.len() - first.len(),
            11 * 2 + 11,
            "an offset (2 bytes) and a repeat tag per extra sample"
        );
    }

    #[test]
    fn a_sample_outside_its_minute_is_refused() {
        for offset in [-1, MINUTE_MS] {
            let error = encode(MINUTE, &[at(offset, &[("a", 1.0)])], &ids()).expect_err("outside");
            assert_eq!(error, SampleError::OutsideMinute { at_ms: MINUTE * MINUTE_MS + offset });
        }
    }

    #[test]
    fn a_metric_without_an_id_is_refused() {
        let error = encode(MINUTE, &[at(0, &[("zzz", 1.0)])], &ids()).expect_err("unknown");
        assert_eq!(error, SampleError::UnknownMetric("zzz".to_owned()));
    }

    #[test]
    fn damaged_blobs_are_refused_not_misread() {
        let good = encode(MINUTE, &[at(0, &[("a", 1.5)]), at(9, &[("a", 1.5)])], &ids()).expect("encode");
        for cut in 0..good.len() {
            assert!(decode(MINUTE, &good[..cut], &keys()).is_err(), "cut at {cut}");
        }
        let mut other_version = good.clone();
        other_version[0] = 2;
        assert_eq!(decode(MINUTE, &other_version, &keys()), Err(SampleError::Corrupt("unknown version")));
        let mut other_tag = good.clone();
        let last_tag = other_tag.len() - 1;
        other_tag[last_tag] = 9;
        assert_eq!(decode(MINUTE, &other_tag, &keys()), Err(SampleError::Corrupt("unknown cell tag")));
        assert_eq!(decode(MINUTE, &[], &keys()), Err(SampleError::Corrupt("empty")));
    }

    #[test]
    fn a_repeat_with_nothing_before_it_is_refused() {
        // version, 1 sample, offset 0, 1 metric, id 1, tag "same as before"
        let blob = [1, 1, 0, 1, 1, 1];
        assert_eq!(decode(MINUTE, &blob, &keys()), Err(SampleError::Corrupt("repeat without a value")));
    }

    #[test]
    fn counts_larger_than_the_blob_are_refused_before_allocating() {
        let blob = [1, 0xff, 0xff, 0xff, 0xff, 0x0f];
        assert_eq!(decode(MINUTE, &blob, &keys()), Err(SampleError::Corrupt("count exceeds the blob")));
        let endless = [1, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff];
        assert_eq!(decode(MINUTE, &endless, &keys()), Err(SampleError::Corrupt("varint overflow")));
    }

    #[test]
    fn an_offset_past_the_minute_in_a_blob_is_refused() {
        let blob = [1, 1, 0xe0, 0xd4, 0x03, 0];
        assert_eq!(decode(MINUTE, &blob, &keys()), Err(SampleError::Corrupt("offset outside the minute")));
    }

    fn times(samples: &[Sample]) -> Vec<i64> {
        samples.iter().map(|s| s.at_ms - MINUTE * MINUTE_MS).collect()
    }

    #[test]
    fn a_minute_closes_when_the_next_one_starts_and_stays_held_until_released() {
        let unstored = Unstored::default();
        assert!(unstored.push(1, at(0, &[("a", 1.0)])).is_none());
        assert!(unstored.push(1, at(59_999, &[("a", 2.0)])).is_none());
        let closed = unstored.push(1, at(MINUTE_MS, &[])).expect("closed");
        assert_eq!((closed.minute, times(&closed.samples)), (MINUTE, vec![0, 59_999]));
        assert_eq!(times(&unstored.held(1)), [0, 59_999, MINUTE_MS], "unwritten, so still readable");
        unstored.release(1, MINUTE);
        assert_eq!(times(&unstored.held(1)), [MINUTE_MS]);
        let open = unstored.newest(1).expect("the new minute is open");
        assert_eq!((open.minute, times(&open.samples)), (MINUTE + 1, vec![MINUTE_MS]));
        unstored.release(1, MINUTE + 1);
        assert_eq!(unstored.held(1), []);
        assert!(unstored.newest(1).is_none());
    }

    #[test]
    fn each_device_holds_its_own_minute() {
        let unstored = Unstored::default();
        unstored.push(1, at(0, &[("a", 1.0)]));
        unstored.push(2, at(10, &[("a", 2.0)]));
        assert!(unstored.push(2, at(MINUTE_MS, &[])).is_some());
        assert_eq!(times(&unstored.held(1)), [0], "device 2's minute closes nothing of device 1");
        unstored.release(2, MINUTE);
        assert_eq!(times(&unstored.held(1)), [0]);
        assert_eq!(times(&unstored.held(2)), [MINUTE_MS]);
        assert_eq!(unstored.held(3), []);
    }

    fn ok(samples: &[Sample]) -> Vec<Result<Sample, SampleError>> {
        samples.iter().cloned().map(Ok).collect()
    }

    #[test]
    fn readings_held_after_the_stored_ones_read_after_them() {
        let stored = [at(1_000, &[("a", 1.0)]), at(2_000, &[("a", 2.0)])];
        let held = vec![at(3_000, &[("a", 3.0)]), at(4_000, &[("a", 4.0)])];
        let read: Vec<Sample> = with_unstored(ok(&stored), held).collect::<Result<_, _>>().expect("readings");
        assert_eq!(times(&read), [1_000, 2_000, 3_000, 4_000]);
    }

    #[test]
    fn a_closed_minute_written_but_not_yet_released_reads_once() {
        let stored = [at(1_000, &[("a", 1.0)]), at(2_000, &[("a", 2.0)])];
        let held = vec![at(1_000, &[("a", 1.0)]), at(2_000, &[("a", 2.0)]), at(MINUTE_MS, &[("a", 3.0)])];
        let read: Vec<Sample> = with_unstored(ok(&stored), held).collect::<Result<_, _>>().expect("readings");
        assert_eq!(times(&read), [1_000, 2_000, MINUTE_MS]);
    }

    #[test]
    fn nothing_stored_reads_what_is_held_and_a_damaged_minute_stays_an_error() {
        let held = vec![at(5, &[("a", 1.0)])];
        let read: Vec<Sample> = with_unstored(ok(&[]), held.clone()).collect::<Result<_, _>>().expect("ok");
        assert_eq!(times(&read), [5]);
        let damaged = vec![Err(SampleError::Corrupt("truncated"))];
        let read: Vec<_> = with_unstored(damaged, held).collect();
        assert_eq!(read[0], Err(SampleError::Corrupt("truncated")));
        assert_eq!(read.len(), 2);
    }
}
