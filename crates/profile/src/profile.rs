//! Loading: the document is validated and compiled into quantities and a read plan.

use std::collections::HashMap;
use std::fmt;

use serde::Deserialize;

use crate::document::{ExprDoc, Header, Kind, ProfileDoc, QuantityDoc, Range, SettingDoc, StepDoc};
use crate::plan::{self, Block};
use crate::setting::{self, Setting};
use crate::sunspec::Chain;
use crate::{CAPABILITIES, SCHEMA};

/// A loaded profile: its quantities in file order and its compiled read plan.
#[derive(Debug, Clone)]
pub struct Profile {
    pub id: String,
    pub name: String,
    pub manufacturer: String,
    pub version: String,
    quantities: Vec<Quantity>,
    plan: Vec<Block>,
    inverter: Option<Inverter>,
    settings: Vec<Setting>,
    warnings: Vec<String>,
    /// The SunSpec chain it is bound to, whose models its plan reads.
    chain: Option<Chain>,
}

/// An inverter's DC side from its datasheet (ADR 5, 17).
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Inverter {
    /// Volts.
    pub max_input_voltage: f64,
    /// The MPPT inputs, numbered from 1 in order, as `pv.mppt.*` indices.
    pub mppt: Vec<Mppt>,
}

/// One MPPT input's limits.
#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
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
#[derive(Debug, Clone)]
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

#[derive(Debug, Clone)]
pub enum Read {
    Register(Register),
    /// A register of the first of `models` a SunSpec chain holds, its addresses counted from the
    /// model's ID register; unread until bound to a chain that holds it.
    Point {
        models: Vec<u16>,
        register: Register,
    },
    /// A topic under the connection's root, with `{address}` unsubstituted.
    Topic {
        topic: String,
        scale: f64,
        offset: f64,
        /// Text payloads and the values they read as.
        texts: Vec<(String, f64)>,
    },
    Compute(Expr),
}

#[derive(Debug, Clone, Copy)]
pub struct Register {
    pub address: u16,
    pub kind: Kind,
    pub scale: f64,
    pub offset: f64,
    /// The register of its power-of-ten scale factor.
    pub scale_factor: Option<u16>,
    /// Read as SunSpec encodes: double words high first, and its type's sentinel is no value.
    pub sunspec: bool,
}

/// A derived value over the positions of quantities declared earlier.
#[derive(Debug, Clone)]
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

/// What a quantity reads through.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Binding {
    Registers,
    Topics,
    SunSpec,
}

impl Read {
    /// `None` for a computed quantity.
    const fn binding(&self) -> Option<Binding> {
        match self {
            Self::Register(_) => Some(Binding::Registers),
            Self::Point { .. } => Some(Binding::SunSpec),
            Self::Topic { .. } => Some(Binding::Topics),
            Self::Compute(_) => None,
        }
    }

    /// Its register in `chain`, if the chain holds it whole; else itself.
    fn bound(&self, chain: &Chain) -> Self {
        let Self::Point { models, register } = self else {
            return self.clone();
        };
        let Some(model) = chain.models().iter().find(|m| models.contains(&m.id)) else {
            return self.clone();
        };
        // Registers 0 and 1 of a model are its header, which `start` follows.
        let at = |offset: u16, words: u16| {
            let from = offset.checked_sub(2)?;
            (u32::from(from) + u32::from(words) <= u32::from(model.length))
                .then(|| model.start.checked_add(from))
                .flatten()
        };
        let address = at(register.address, register.kind.words());
        let scale_factor = register.scale_factor.map(|sf| at(sf, 1));
        match (address, scale_factor) {
            (Some(address), None) => Self::Register(Register {
                address,
                sunspec: true,
                ..*register
            }),
            (Some(address), Some(Some(sf))) => Self::Register(Register {
                address,
                scale_factor: Some(sf),
                sunspec: true,
                ..*register
            }),
            _ => self.clone(),
        }
    }
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
    Setting {
        key: String,
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
            Self::Setting { key, problem } => write!(f, "setting `{key}`: {problem}"),
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
        let warnings = unrequired(&doc)
            .map(|name| format!("`requires` lacks `{name}`, which the profile uses"))
            .collect();
        let quantities = compile(doc.quantities)?;
        let plan = plan::compile(&quantities);
        let settings = setting::compile(doc.settings, &quantities)
            .map_err(|(key, problem)| LoadError::Setting { key, problem })?;
        Ok(Self {
            id: doc.id,
            name: doc.name,
            manufacturer: doc.manufacturer,
            version: doc.version,
            quantities,
            plan,
            inverter: doc.inverter,
            settings,
            warnings,
            chain: None,
        })
    }

    /// Whether it reads SunSpec models, so its read plan compiles at connect from the device's
    /// chain (see [`Profile::bind`]).
    #[must_use]
    pub fn reads_sunspec(&self) -> bool {
        self.quantities
            .iter()
            .any(|q| q.read.binding() == Some(Binding::SunSpec))
    }

    /// The profile as it reads the device whose SunSpec model chain is `chain`: each quantity at
    /// its register in the first of its models the chain holds, and every model in the plan. A
    /// quantity of a model the chain lacks, or past its model's end, stays unread.
    #[must_use]
    pub fn bind(&self, chain: &Chain) -> Self {
        let quantities = self
            .quantities
            .iter()
            .map(|q| Quantity {
                read: q.read.bound(chain),
                ..q.clone()
            })
            .collect();
        Self {
            quantities,
            chain: Some(chain.clone()),
            ..self.clone()
        }
    }

    /// What the profile should not say but may: the text the CLI, the core log and the SPA all
    /// show (ADR 5).
    #[must_use]
    pub fn warnings(&self) -> &[String] {
        &self.warnings
    }

    /// The inverter's DC side, when the profile declares one.
    #[must_use]
    pub const fn inverter(&self) -> Option<&Inverter> {
        self.inverter.as_ref()
    }

    /// The settings in file order.
    #[must_use]
    pub fn settings(&self) -> &[Setting] {
        &self.settings
    }

    /// The setting `key`, when the profile declares one.
    #[must_use]
    pub fn setting(&self, key: &str) -> Option<&Setting> {
        self.settings.iter().find(|s| s.key == key)
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
        self.chain.as_ref().map_or_else(
            || plan::merge_across_gaps(&self.plan, gap_tolerance),
            |chain| chain.read_plan(gap_tolerance),
        )
    }

    /// A spanning block's mapped registers as plain blocks: the fallback when a device refuses it
    /// with Modbus exception 2.
    #[must_use]
    pub fn split(&self, block: Block) -> Vec<Block> {
        self.chain.as_ref().map_or_else(
            || plan::split(&self.quantities, block),
            |chain| chain.split(block),
        )
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

/// Capabilities the profile uses but does not require, in table order: an older core lacking one
/// would refuse the profile without naming the capability.
fn unrequired(doc: &ProfileDoc) -> impl Iterator<Item = &'static str> + '_ {
    let settings = doc.settings.iter();
    let unlocks = settings.clone().flat_map(|s| {
        s.recipe.iter().filter_map(|step| {
            if let StepDoc::Unlock(u) = step {
                Some(u.kind.capability())
            } else {
                None
            }
        })
    });
    let used: Vec<&str> = doc
        .quantities
        .iter()
        .flat_map(QuantityDoc::capabilities)
        .chain(settings.clone().map(|s| s.kind.capability()))
        .chain(unlocks)
        .chain(
            settings
                .clone()
                .map(|s| if publishes(s) { "mqtt" } else { "modbus" }),
        )
        .chain(settings.flat_map(|s| s.recipe.iter().map(StepDoc::capability)))
        .collect();
    CAPABILITIES
        .iter()
        .copied()
        .filter(move |name| used.contains(name) && !doc.requires.iter().any(|r| r == name))
}

/// Whether a setting writes through the `mqtt` binding.
fn publishes(setting: &SettingDoc) -> bool {
    setting
        .recipe
        .iter()
        .any(|step| matches!(step, StepDoc::Publish(_)))
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
        let first = quantities.iter().find_map(|q: &Quantity| q.read.binding());
        if read
            .binding()
            .zip(first)
            .is_some_and(|(this, first)| this != first)
        {
            return Err(refuse("a profile reads through one binding"));
        }
        let step = doc.resolution.unwrap_or_else(|| step(&read, &quantities));
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
        Read::Register(Register { scale, .. })
        | Read::Point {
            register: Register { scale, .. },
            ..
        }
        | Read::Topic { scale, .. } => scale.abs(),
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
    let scale = doc.scale.unwrap_or(1.0);
    let offset = doc.offset.unwrap_or(0.0);
    if doc.texts.is_some() && doc.topic.is_none() {
        return Err("only a topic maps texts");
    }
    if doc.scale_factor.is_some() != doc.resolution.is_some() {
        return Err("a scale factor and a resolution come together");
    }
    if doc.scale_factor.is_some() && doc.register.is_none() {
        return Err("only a register takes a scale factor");
    }
    if doc.model.is_some() && doc.register.is_none() {
        return Err("a SunSpec model is read at a register");
    }
    match (doc.register, &doc.topic, &doc.compute) {
        (Some(address), None, None) => register(doc, address, scale, offset),
        (None, Some(topic), None) => {
            if doc.kind.is_some() {
                return Err("a topic takes no type");
            }
            if topic.is_empty() || topic.starts_with('/') || topic.contains(['+', '#']) {
                return Err("a topic is a path under the root, without wildcards");
            }
            Ok(Read::Topic {
                topic: topic.clone(),
                scale,
                offset,
                texts: doc.texts.clone().unwrap_or_default().into_iter().collect(),
            })
        }
        (None, None, Some(expr)) if doc.kind.is_none() => {
            if doc.scale.is_some() || doc.offset.is_some() {
                return Err("a computed quantity takes no scale or offset");
            }
            expr_of(expr, positions).map(Read::Compute)
        }
        _ => Err("declare one of `register`, `topic` or `compute`"),
    }
}

fn register(
    doc: &QuantityDoc,
    address: u16,
    scale: f64,
    offset: f64,
) -> Result<Read, &'static str> {
    let kind = doc.kind.ok_or("a register needs a type")?;
    if kind.words() == 2 && address == u16::MAX {
        return Err("a double word needs two registers");
    }
    let register = Register {
        address,
        kind,
        scale,
        offset,
        scale_factor: doc.scale_factor,
        sunspec: false,
    };
    match &doc.model {
        None if kind == Kind::Acc32 => Err("an acc32 is a SunSpec point"),
        None => Ok(Read::Register(register)),
        Some(models) if models.is_empty() => Err("list at least one SunSpec model"),
        Some(_) if address < 2 || doc.scale_factor.is_some_and(|sf| sf < 2) => {
            Err("registers 0 and 1 of a SunSpec model are its header")
        }
        Some(models) => Ok(Read::Point {
            models: models.clone(),
            register,
        }),
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
