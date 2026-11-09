//! Decoding, ported from v4: a register yields `raw * scale + offset` clamped to its range, and an
//! unanswered register yields no value, never zero. A computed quantity reads a missing input as 0.

use std::collections::HashMap;

use serde_json::Value;

use crate::ADDRESS;
use crate::document::{Kind, Range};
use crate::profile::{Expr, Profile, Read, Register};

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
                Read::Register(register) => read(register, registers)
                    .filter(|value| value.is_finite())
                    .map(|value| clamped(quantity.range, value)),
                Read::Compute(expr) => Some(clamped(quantity.range, evaluate(expr, values))),
                Read::Point { .. } | Read::Topic { .. } | Read::Json { .. } => None,
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

    /// Whether it reads through the `http` binding: a device behind an HTTP host needs one that
    /// does.
    #[must_use]
    pub fn reads_http(&self) -> bool {
        self.quantities()
            .iter()
            .any(|q| matches!(q.read, Read::Json { .. }))
    }

    /// Each GET its quantities read, once, in file order, with `address` in place of its address
    /// mark: one poll of the device.
    #[must_use]
    pub fn requests(&self, address: u32) -> Vec<String> {
        let address = address.to_string();
        let mut requests: Vec<String> = Vec::new();
        let gets = self.quantities().iter().filter_map(|q| match &q.read {
            Read::Json { get, .. } => Some(get.replace(ADDRESS, &address)),
            Read::Register(_) | Read::Point { .. } | Read::Topic { .. } | Read::Compute(_) => None,
        });
        for get in gets {
            if !requests.contains(&get) {
                requests.push(get);
            }
        }
        requests
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
                Read::Register(_) | Read::Point { .. } | Read::Json { .. } | Read::Compute(_) => {
                    None
                }
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
        self.recompute(values);
    }

    /// Takes `body`, the answer to `get` on the device at `address`, into the value of every
    /// quantity read from it, and recomputes every computed quantity. What its JSON Pointer
    /// finds reads as a topic's payload does; an unreadable answer leaves them no value.
    pub fn answer(&self, address: u32, get: &str, body: &[u8], values: &mut [Option<f64>]) {
        let document: Option<Value> = serde_json::from_slice(body).ok();
        let address = address.to_string();
        for (position, quantity) in self.quantities().iter().enumerate() {
            let Read::Json {
                get: ref asked,
                ref pointer,
                scale,
                offset,
            } = quantity.read
            else {
                continue;
            };
            if asked.replace(ADDRESS, &address) != get {
                continue;
            }
            let value = document
                .as_ref()
                .and_then(|d| d.pointer(pointer))
                .and_then(number)
                .map(|raw| scaled(raw, scale, offset))
                .filter(|value| value.is_finite())
                .map(|value| clamped(quantity.range, value));
            if let Some(slot) = values.get_mut(position) {
                *slot = value;
            }
        }
        self.recompute(values);
    }

    fn recompute(&self, values: &mut [Option<f64>]) {
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

/// A number, or `true` and `false` as 1 and 0; anything else is no value.
fn number(value: &Value) -> Option<f64> {
    match value {
        Value::Number(n) => n.as_f64(),
        Value::Bool(on) => Some(f64::from(u8::from(*on))),
        Value::Null | Value::String(_) | Value::Array(_) | Value::Object(_) => None,
    }
}

fn parse(payload: &[u8], texts: &[(String, f64)]) -> Option<f64> {
    if !texts.is_empty() {
        return texts
            .iter()
            .find(|(text, _)| text.as_bytes() == payload)
            .map(|(_, value)| *value);
    }
    number(&serde_json::from_slice(payload).ok()?)
}

/// `None` while a word is unanswered, or for a SunSpec sentinel.
pub fn read(register: &Register, registers: &Registers) -> Option<f64> {
    let Register {
        address,
        kind,
        scale,
        offset,
        scale_factor,
        sunspec,
    } = *register;
    let first = registers.word(address)?;
    let raw = match kind {
        Kind::U16 => (!sunspec || first != 0xFFFF).then_some(f64::from(first))?,
        Kind::I16 => {
            let value = i16::from_ne_bytes(first.to_ne_bytes());
            (!sunspec || value != i16::MIN).then_some(f64::from(value))?
        }
        Kind::U32 | Kind::Acc32 => {
            let second = registers.word(address.checked_add(1)?)?;
            let (high, low) = if sunspec {
                (first, second)
            } else {
                (second, first)
            };
            let value = u32::from(high) << 16 | u32::from(low);
            let sentinel = match kind {
                Kind::Acc32 => Some(0),
                Kind::U32 if sunspec => Some(u32::MAX),
                Kind::U16 | Kind::I16 | Kind::U32 => None,
            };
            (sentinel != Some(value)).then_some(f64::from(value))?
        }
    };
    let exponent = match scale_factor {
        Some(at) => {
            let exponent = i16::from_ne_bytes(registers.word(at)?.to_ne_bytes());
            (!sunspec || exponent != i16::MIN).then_some(i32::from(exponent))?
        }
        None => 0,
    };
    // Dividing by 10^n keeps 5999 at -2 exactly 59.99, which multiplying by 0.01 does not.
    let factor = 10_f64.powi(exponent.abs());
    let powered = if exponent < 0 {
        raw / factor
    } else {
        raw * factor
    };
    Some(scaled(powered, scale, offset))
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
