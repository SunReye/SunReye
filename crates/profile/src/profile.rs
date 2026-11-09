//! Loading: the document is validated and compiled into quantities and a read plan.

use std::collections::HashMap;
use std::fmt;

use serde::Deserialize;

use crate::document::{ExprDoc, Header, Kind, ProfileDoc, QuantityDoc, Range};
use crate::plan::{self, Block};
use crate::{CAPABILITIES, SCHEMA};

/// A loaded profile: its quantities in file order and its compiled read plan.
#[derive(Debug)]
pub struct Profile {
    pub id: String,
    pub name: String,
    pub manufacturer: String,
    pub version: String,
    quantities: Vec<Quantity>,
    plan: Vec<Block>,
    inverter: Option<Inverter>,
}

/// An inverter's DC side from its datasheet (ADR 5, 17).
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Inverter {
    /// Volts.
    pub max_input_voltage: f64,
    /// The MPPT inputs, numbered from 1 in order, as `pv.mppt.*` indices.
    pub mppt: Vec<Mppt>,
}

/// One MPPT input's limits.
#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Mppt {
    /// Amperes.
    pub max_current: f64,
    /// The voltage window, in volts.
    pub min_voltage: f64,
    pub max_voltage: f64,
    /// Volts.
    pub start_voltage: f64,
}

/// One quantity a profile reads or derives, published as a role at an optional index.
#[derive(Debug)]
pub struct Quantity {
    pub key: String,
    pub role: String,
    pub index: Option<u32>,
    pub(crate) read: Read,
    pub(crate) range: Option<Range>,
    step: f64,
}

impl Quantity {
    /// The quantisation step it is stored in, in its role's unit (ADR 3): a register's scale; for a
    /// computed quantity the finest step of its inputs, and for a ratio a thousandth of its scale.
    #[must_use]
    pub const fn step(&self) -> f64 {
        self.step
    }
}

#[derive(Debug)]
pub enum Read {
    Register {
        address: u16,
        kind: Kind,
        scale: f64,
        offset: f64,
    },
    Compute(Expr),
}

/// A derived value over the positions of quantities declared earlier.
#[derive(Debug)]
pub enum Expr {
    Sum(Vec<usize>),
    Diff(usize, usize),
    Combine {
        add: Vec<usize>,
        sub: Vec<usize>,
    },
    Ratio {
        num: Vec<usize>,
        den: Vec<usize>,
        scale: f64,
    },
    Clamp {
        input: usize,
        min: Option<f64>,
        max: Option<f64>,
    },
}

impl Expr {
    pub fn inputs(&self) -> Vec<usize> {
        match self {
            Self::Sum(list) => list.clone(),
            Self::Diff(a, b) => vec![*a, *b],
            Self::Combine { add: a, sub: b } | Self::Ratio { num: a, den: b, .. } => {
                [a.as_slice(), b].concat()
            }
            Self::Clamp { input, .. } => vec![*input],
        }
    }
}

/// Why a profile was refused.
#[derive(Debug, PartialEq, Eq)]
pub enum LoadError {
    Malformed(String),
    Schema(u32),
    MissingCapability(String),
    Quantity {
        key: String,
        problem: &'static str,
    },
    /// An MPPT input, numbered from 1.
    Mppt {
        input: usize,
        problem: &'static str,
    },
}

impl fmt::Display for LoadError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Malformed(reason) => write!(f, "malformed profile: {reason}"),
            Self::Schema(found) => write!(
                f,
                "schema {found} is not supported; this build loads schema {SCHEMA}"
            ),
            Self::MissingCapability(name) => {
                write!(f, "this build lacks the required capability `{name}`")
            }
            Self::Quantity { key, problem } => write!(f, "quantity `{key}`: {problem}"),
            Self::Mppt { input, problem } => write!(f, "MPPT input {input}: {problem}"),
        }
    }
}

impl std::error::Error for LoadError {}

impl Profile {
    /// Validates a profile file and compiles its read plan.
    ///
    /// # Errors
    /// The file is not a profile of the supported schema, needs a capability this build lacks, or a
    /// quantity is inconsistent.
    pub fn load(json: &str) -> Result<Self, LoadError> {
        let header: Header = serde_json::from_str(json).map_err(|e| malformed(&e))?;
        if header.schema != SCHEMA {
            return Err(LoadError::Schema(header.schema));
        }
        let doc: ProfileDoc = serde_json::from_str(json).map_err(|e| malformed(&e))?;
        if let Some(missing) = doc
            .requires
            .iter()
            .find(|name| !CAPABILITIES.contains(&name.as_str()))
        {
            return Err(LoadError::MissingCapability(missing.clone()));
        }
        doc.inverter.as_ref().map_or(Ok(()), check)?;
        let quantities = compile(doc.quantities)?;
        let plan = plan::compile(&quantities);
        Ok(Self {
            id: doc.id,
            name: doc.name,
            manufacturer: doc.manufacturer,
            version: doc.version,
            quantities,
            plan,
            inverter: doc.inverter,
        })
    }

    /// The inverter's DC side, when the profile declares one.
    #[must_use]
    pub const fn inverter(&self) -> Option<&Inverter> {
        self.inverter.as_ref()
    }

    /// The quantities in file order; [`Profile::decode`] fills one value per quantity.
    #[must_use]
    pub fn quantities(&self) -> &[Quantity] {
        &self.quantities
    }

    /// The reads for one poll, folded across gaps of at most `gap_tolerance` unmapped registers
    /// (see [`crate::Framing::gap_tolerance`]).
    #[must_use]
    pub fn read_plan(&self, gap_tolerance: u16) -> Vec<Block> {
        plan::merge_across_gaps(&self.plan, gap_tolerance)
    }

    /// A spanning block's mapped registers as plain blocks: the fallback when a device refuses it
    /// with Modbus exception 2.
    #[must_use]
    pub fn split(&self, block: Block) -> Vec<Block> {
        plan::split(&self.quantities, block)
    }
}

fn check(inverter: &Inverter) -> Result<(), LoadError> {
    inverter
        .mppt
        .iter()
        .position(|m| m.min_voltage > m.max_voltage)
        .map_or(Ok(()), |at| {
            Err(LoadError::Mppt {
                input: at + 1,
                problem: "the voltage window is inverted",
            })
        })
}

fn malformed(error: &serde_json::Error) -> LoadError {
    LoadError::Malformed(error.to_string())
}

fn compile(docs: Vec<QuantityDoc>) -> Result<Vec<Quantity>, LoadError> {
    let mut positions: HashMap<String, usize> = HashMap::new();
    let mut quantities = Vec::with_capacity(docs.len());
    for doc in docs {
        let refuse = |problem| LoadError::Quantity {
            key: doc.key.clone(),
            problem,
        };
        if positions.contains_key(&doc.key) {
            return Err(refuse("the key is declared twice"));
        }
        let read = read(&doc, &positions).map_err(refuse)?;
        let step = step(&read, &quantities);
        positions.insert(doc.key.clone(), quantities.len());
        quantities.push(Quantity {
            key: doc.key,
            role: doc.role,
            index: doc.index,
            read,
            range: doc.range,
            step,
        });
    }
    Ok(quantities)
}

/// `earlier` holds every input of a computed `read`.
fn step(read: &Read, earlier: &[Quantity]) -> f64 {
    match read {
        Read::Register { scale, .. } => scale.abs(),
        Read::Compute(Expr::Ratio { scale, .. }) => scale.abs() / 1000.0,
        Read::Compute(expr) => expr
            .inputs()
            .into_iter()
            .filter_map(|at| earlier.get(at))
            .map(|q| q.step)
            .fold(f64::INFINITY, f64::min),
    }
}

fn read(doc: &QuantityDoc, positions: &HashMap<String, usize>) -> Result<Read, &'static str> {
    match (doc.register, doc.kind, &doc.compute) {
        (Some(address), Some(kind), None) => {
            if kind == Kind::U32 && address == u16::MAX {
                return Err("a u32 needs two registers");
            }
            Ok(Read::Register {
                address,
                kind,
                scale: doc.scale.unwrap_or(1.0),
                offset: doc.offset.unwrap_or(0.0),
            })
        }
        (None, None, Some(expr)) if doc.scale.is_none() && doc.offset.is_none() => {
            expr_of(expr, positions).map(Read::Compute)
        }
        (None, None, Some(_)) => Err("a computed quantity takes no scale or offset"),
        (Some(_), None, None) => Err("a register needs a type"),
        _ => Err("declare either `register` with `type`, or `compute`"),
    }
}

fn expr_of(doc: &ExprDoc, positions: &HashMap<String, usize>) -> Result<Expr, &'static str> {
    let at = |key: &String| {
        positions
            .get(key)
            .copied()
            .ok_or("an input is not a quantity declared earlier")
    };
    let all = |keys: &[String]| keys.iter().map(at).collect::<Result<Vec<_>, _>>();
    Ok(match doc {
        ExprDoc::Sum(keys) => Expr::Sum(all(keys)?),
        ExprDoc::Diff([a, b]) => Expr::Diff(at(a)?, at(b)?),
        ExprDoc::Combine { add, sub } => Expr::Combine {
            add: all(add)?,
            sub: all(sub)?,
        },
        ExprDoc::Ratio { num, den, scale } => Expr::Ratio {
            num: all(num)?,
            den: all(den)?,
            scale: scale.unwrap_or(1.0),
        },
        ExprDoc::Clamp { key, min, max } => Expr::Clamp {
            input: at(key)?,
            min: *min,
            max: *max,
        },
    })
}
