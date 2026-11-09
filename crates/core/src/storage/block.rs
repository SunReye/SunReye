//! The hourly block: one series' change points of one closed hour (ADR 3).
//!
//! A version byte, then per point the zigzag varint delta of its time from the previous point (the
//! first from the hour's start) and one varint word: 1 for a gap, else the zigzag delta of its value
//! from the previous value, shifted left once.

use super::encode::{Point, Tick};

const VERSION: u8 = 1;
const GAP: u64 = 1;

pub fn encode(hour: Tick, points: &[Point]) -> Vec<u8> {
    let mut block = vec![VERSION];
    let (mut time, mut value) = (hour, 0);
    for point in points {
        varint(&mut block, zigzag(point.time - time));
        time = point.time;
        let word = point.value.map_or(GAP, |v| {
            let delta = zigzag(v - value);
            value = v;
            delta << 1
        });
        varint(&mut block, word);
    }
    block
}

/// `None` for a block this build cannot read.
pub fn decode(hour: Tick, block: &[u8]) -> Option<Vec<Point>> {
    let (&version, mut rest) = block.split_first()?;
    if version != VERSION {
        return None;
    }
    let mut points = Vec::new();
    let (mut time, mut value) = (hour, 0i64);
    while !rest.is_empty() {
        time = time.checked_add(unzigzag(read(&mut rest)?))?;
        let word = read(&mut rest)?;
        let point = if word == GAP {
            None
        } else {
            value = value.checked_add(unzigzag(word >> 1))?;
            Some(value)
        };
        points.push(Point { time, value: point });
    }
    Some(points)
}

#[expect(
    clippy::cast_sign_loss,
    reason = "zigzag maps the sign into the low bit"
)]
const fn zigzag(n: i64) -> u64 {
    ((n << 1) ^ (n >> 63)) as u64
}

#[expect(
    clippy::cast_possible_wrap,
    reason = "zigzag maps the sign into the low bit"
)]
const fn unzigzag(n: u64) -> i64 {
    (n >> 1) as i64 ^ -((n & 1) as i64)
}

fn varint(out: &mut Vec<u8>, mut n: u64) {
    while n >= 0x80 {
        #[expect(clippy::cast_possible_truncation, reason = "the low seven bits")]
        out.push(n as u8 | 0x80);
        n >>= 7;
    }
    #[expect(clippy::cast_possible_truncation, reason = "under 0x80")]
    out.push(n as u8);
}

fn read(input: &mut &[u8]) -> Option<u64> {
    let mut n = 0u64;
    for shift in (0..64).step_by(7) {
        let (&byte, rest) = input.split_first()?;
        *input = rest;
        n |= u64::from(byte & 0x7f) << shift;
        if byte < 0x80 {
            return Some(n);
        }
    }
    None
}

#[cfg(test)]
mod tests;
