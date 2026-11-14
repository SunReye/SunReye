//! The identify probe (ADR 5): fields that tell a profile's device from any other on the bus.

use crate::decode::{self, Registers};
use crate::document::{IdentifyDoc, Kind};
use crate::plan::Block;
use crate::profile::{LoadError, Register};

/// A register, read at scale 1, and the values that identify the device; any value when `None`.
#[derive(Debug, Clone)]
pub struct Field {
    register: Register,
    values: Option<Vec<f64>>,
}

/// `family`: the profile declares variants, so a field may leave its values to them.
pub fn compile(docs: Vec<IdentifyDoc>, family: bool) -> Result<Vec<Field>, LoadError> {
    let fields = docs
        .into_iter()
        .map(|doc| field(doc, family))
        .collect::<Result<Vec<_>, _>>()?;
    match fields.first() {
        Some(first) if fields.iter().all(|f| f.values.is_none()) => Err(LoadError::Identify {
            register: first.register.address,
            problem: "a probe needs a field that lists values",
        }),
        _ => Ok(fields),
    }
}

fn field(doc: IdentifyDoc, family: bool) -> Result<Field, LoadError> {
    let kind = doc.kind.unwrap_or(Kind::U16);
    let refuse = |problem| {
        Err(LoadError::Identify {
            register: doc.register,
            problem,
        })
    };
    let values = match doc.values {
        None if family => None,
        Some(values) if !values.is_empty() => Some(values),
        None | Some(_) => return refuse("a field lists the values it may hold"),
    };
    if !values.iter().flatten().all(|v| fits(kind, *v)) {
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
        values,
    })
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
            decode::read(&f.register, registers)
                .is_some_and(|value| f.values.as_ref().is_none_or(|v| v.contains(&value)))
        })
}

/// Whether one device could match both probes: every field of one register shares a value. Both
/// declare the same fields in the same order, as variants of one base do.
pub fn overlap(a: &[Field], b: &[Field]) -> bool {
    a.iter().zip(b).all(|(a, b)| match (&a.values, &b.values) {
        (Some(a), Some(b)) => a.iter().any(|v| b.contains(v)),
        _ => true,
    })
}
