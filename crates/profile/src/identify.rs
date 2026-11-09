//! The identify probe (ADR 5): fields that tell a profile's device from any other on the bus.

use crate::decode::{self, Registers};
use crate::document::{IdentifyDoc, Kind};
use crate::plan::Block;
use crate::profile::{LoadError, Register};

/// A register, read at scale 1, and the values that identify the device.
#[derive(Debug, Clone)]
pub struct Field {
    register: Register,
    values: Vec<f64>,
}

pub fn compile(docs: Vec<IdentifyDoc>) -> Result<Vec<Field>, LoadError> {
    docs.into_iter()
        .map(|doc| {
            let kind = doc.kind.unwrap_or(Kind::U16);
            let refuse = |problem| {
                Err(LoadError::Identify {
                    register: doc.register,
                    problem,
                })
            };
            if doc.values.is_empty() {
                return refuse("a field lists the values it may hold");
            }
            if !doc.values.iter().all(|v| fits(kind, *v)) {
                return refuse("a value does not fit the field's type");
            }
            Ok(Field {
                register: Register {
                    address: doc.register,
                    kind,
                    scale: 1.0,
                    offset: 0.0,
                    scale_factor: None,
                    sunspec: false,
                },
                values: doc.values,
            })
        })
        .collect()
}

fn fits(kind: Kind, value: f64) -> bool {
    let (min, max) = match kind {
        Kind::U16 => (0.0, f64::from(u16::MAX)),
        Kind::I16 => (f64::from(i16::MIN), f64::from(i16::MAX)),
        Kind::U32 | Kind::Acc32 => (0.0, f64::from(u32::MAX)),
    };
    value.fract() == 0.0 && (min..=max).contains(&value)
}

/// One block per field, in declaration order.
pub fn plan(fields: &[Field]) -> Vec<Block> {
    fields
        .iter()
        .map(|f| Block {
            start: f.register.address,
            count: f.register.kind.words(),
            grouped: false,
            merged: false,
        })
        .collect()
}

/// Every field answered one of its values; nothing is identified by no fields.
pub fn matches(fields: &[Field], registers: &Registers) -> bool {
    !fields.is_empty()
        && fields.iter().all(|f| {
            decode::read(&f.register, registers).is_some_and(|value| f.values.contains(&value))
        })
}
