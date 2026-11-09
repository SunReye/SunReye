//! Decoding, ported from v4: a register yields `raw * scale + offset` clamped to its range, and an
//! unanswered register yields no value, never zero. A computed quantity reads a missing input as 0.

use std::collections::HashMap;

use serde_json::Value;

use crate::ADDRESS;
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
                    scale_factor,
                } => raw(*kind, *address, registers)
                    .zip(power(*scale_factor, registers))
                    .map(|(raw, power)| scaled(power(raw), *scale, *offset))
                    .filter(|value| value.is_finite())
                    .map(|value| clamped(quantity.range, value)),
                Read::Compute(expr) => Some(clamped(quantity.range, evaluate(expr, values))),
                Read::Topic { .. } => None,
            };
            if let Some(slot) = values.get_mut(position) {
                *slot = value;
            }
        }
    }
    /// Whether it reads through the `mqtt` binding: a device behind a broker needs one that does.
    #[must_use]
    pub fn reads_topics(&self) -> bool {
        self.quantities()
            .iter()
            .any(|q| matches!(q.read, Read::Topic { .. }))
    }

    /// The topic of every quantity read from one, with `address` in place of its address mark,
    /// by position in [`Profile::quantities`].
    #[must_use]
    pub fn topics(&self, address: u32) -> Vec<(usize, String)> {
        let address = address.to_string();
        self.quantities()
            .iter()
            .enumerate()
            .filter_map(|(position, q)| match &q.read {
                Read::Topic { topic, .. } => Some((position, topic.replace(ADDRESS, &address))),
                Read::Register { .. } | Read::Compute(_) => None,
            })
            .collect()
    }

    /// Takes `payload`, a message on the topic of quantity `position`, into `values`, and
    /// recomputes every computed quantity. A number is scaled, `true` and `false` read as 1 and 0,
    /// a text its enum maps reads as its value, and anything else, such as `null` or an empty
    /// payload, is no value. A topic that maps texts reads nothing else.
    pub fn receive(&self, position: usize, payload: &[u8], values: &mut [Option<f64>]) {
        let Some(quantity) = self.quantities().get(position) else {
            return;
        };
        let Read::Topic {
            scale,
            offset,
            ref texts,
            ..
        } = quantity.read
        else {
            return;
        };
        let value = parse(payload, texts)
            .map(|raw| scaled(raw, scale, offset))
            .filter(|value| value.is_finite())
            .map(|value| clamped(quantity.range, value));
        if let Some(slot) = values.get_mut(position) {
            *slot = value;
        }
        for (at, quantity) in self.quantities().iter().enumerate() {
            let Read::Compute(expr) = &quantity.read else {
                continue;
            };
            let value = clamped(quantity.range, evaluate(expr, values));
            if let Some(slot) = values.get_mut(at) {
                *slot = Some(value);
            }
        }
    }
}

fn parse(payload: &[u8], texts: &[(String, f64)]) -> Option<f64> {
    if !texts.is_empty() {
        return texts
            .iter()
            .find(|(text, _)| text.as_bytes() == payload)
            .map(|(_, value)| *value);
    }
    match serde_json::from_slice(payload).ok()? {
        Value::Number(n) => n.as_f64(),
        Value::Bool(on) => Some(f64::from(u8::from(on))),
        Value::Null | Value::String(_) | Value::Array(_) | Value::Object(_) => None,
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

/// Applies the power of ten in the register `scale_factor`; `None` while that is unanswered.
fn power(scale_factor: Option<u16>, registers: &Registers) -> Option<impl Fn(f64) -> f64> {
    let exponent = match scale_factor {
        Some(address) => i32::from(i16::from_ne_bytes(registers.word(address)?.to_ne_bytes())),
        None => 0,
    };
    // Dividing by 10^n keeps 5999 at -2 exactly 59.99, which multiplying by 0.01 does not.
    let factor = 10_f64.powi(exponent.abs());
    Some(move |raw: f64| {
        if exponent < 0 {
            raw / factor
        } else {
            raw * factor
        }
    })
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
