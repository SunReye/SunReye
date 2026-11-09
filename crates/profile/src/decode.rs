//! Decoding, ported from v4: a register yields `raw * scale + offset` clamped to its range, and an
//! unanswered register yields no value, never zero. A computed quantity reads a missing input as 0.

use std::collections::HashMap;

use crate::document::{Kind, Range};
use crate::profile::{Expr, Profile, Read};

/// The words a device answered in one poll, by address. Reuse it across polls: `clear` keeps its
/// capacity, so a steady poll allocates nothing.
#[derive(Debug, Default)]
pub struct Registers(HashMap<u16, u16>);

impl Registers {
    /// Records `words` read from `start` onwards.
    pub fn answer(&mut self, start: u16, words: &[u16]) {
        self.0.extend((start..=u16::MAX).zip(words.iter().copied()));
    }

    pub fn clear(&mut self) {
        self.0.clear();
    }

    fn word(&self, address: u16) -> Option<u16> {
        self.0.get(&address).copied()
    }
}

impl Profile {
    /// Fills `values` with one value per quantity, in [`Profile::quantities`] order; slots past the
    /// last quantity are left alone.
    pub fn decode(&self, registers: &Registers, values: &mut [Option<f64>]) {
        for (position, quantity) in self.quantities().iter().enumerate() {
            let value = match &quantity.read {
                Read::Register {
                    address,
                    kind,
                    scale,
                    offset,
                } => raw(*kind, *address, registers)
                    .map(|raw| scaled(raw, *scale, *offset))
                    .filter(|value| value.is_finite())
                    .map(|value| clamped(quantity.range, value)),
                Read::Compute(expr) => Some(clamped(quantity.range, evaluate(expr, values))),
            };
            if let Some(slot) = values.get_mut(position) {
                *slot = value;
            }
        }
    }
}

fn raw(kind: Kind, address: u16, registers: &Registers) -> Option<f64> {
    let low = registers.word(address)?;
    match kind {
        Kind::U16 => Some(f64::from(low)),
        Kind::I16 => Some(f64::from(i16::from_ne_bytes(low.to_ne_bytes()))),
        Kind::U32 => {
            let high = registers.word(address.checked_add(1)?)?;
            Some(f64::from(u32::from(high) << 16 | u32::from(low)))
        }
    }
}

#[expect(
    clippy::suboptimal_flops,
    reason = "a fused multiply-add would round differently from v4"
)]
fn scaled(raw: f64, scale: f64, offset: f64) -> f64 {
    raw * scale + offset
}

fn clamped(range: Option<Range>, value: f64) -> f64 {
    range.map_or(value, |r| value.max(r.min).min(r.max))
}

fn evaluate(expr: &Expr, values: &[Option<f64>]) -> f64 {
    let get = |i: &usize| values.get(*i).copied().flatten().unwrap_or(0.0);
    let total = |list: &[usize]| list.iter().map(get).sum::<f64>();
    match expr {
        Expr::Sum(list) => total(list),
        Expr::Diff(a, b) => get(a) - get(b),
        Expr::Combine { add, sub } => total(add) - total(sub),
        Expr::Ratio { num, den, scale } => {
            let denominator = total(den);
            if denominator == 0.0 {
                0.0
            } else {
                total(num) / denominator * scale
            }
        }
        Expr::Clamp { input, min, max } => {
            let low = min.map_or(get(input), |min| get(input).max(min));
            max.map_or(low, |max| low.min(max))
        }
    }
}
