//! The profile file as written. Unknown fields are refused: a field this build does not know may
//! change what a register means.

use serde::Deserialize;

/// Read first, so a profile of another schema is refused by its number, not by its fields.
#[derive(Deserialize)]
pub struct Header {
    pub schema: u32,
}

#[derive(Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(rename = "Profile", optional_fields))]
#[serde(deny_unknown_fields)]
pub struct ProfileDoc {
    #[expect(dead_code, reason = "checked through Header")]
    #[cfg_attr(test, ts(type = "1"))]
    pub schema: u32,
    pub id: String,
    pub name: String,
    pub manufacturer: String,
    pub version: String,
    #[cfg_attr(test, ts(type = "Array<Capability>"))]
    pub requires: Vec<String>,
    pub quantities: Vec<QuantityDoc>,
    pub inverter: Option<crate::Inverter>,
    #[serde(default)]
    #[cfg_attr(test, ts(optional, as = "Option<Vec<SettingDoc>>"))]
    pub settings: Vec<SettingDoc>,
}

#[derive(Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(rename = "Setting", optional_fields))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SettingDoc {
    pub key: String,
    #[serde(rename = "type")]
    pub kind: Kind,
    pub scale: Option<f64>,
    pub range: Option<Range>,
    pub values: Option<Vec<f64>>,
    /// Seconds.
    #[cfg_attr(test, ts(type = "number"))]
    pub min_interval: u64,
    pub recipe: Vec<StepDoc>,
    pub read_back: Option<ReadBackDoc>,
    #[serde(default)]
    #[cfg_attr(test, ts(optional, as = "Option<bool>"))]
    pub write_only: bool,
    /// Its write was checked on real hardware (ADR 5); an unverified setting needs the admin's
    /// enable (ADR 8).
    #[serde(default)]
    #[cfg_attr(test, ts(optional, as = "Option<bool>"))]
    pub verified: bool,
}

#[derive(Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(rename = "Step"))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub enum StepDoc {
    Write(RegisterDoc),
    WriteBlock(BlockDoc),
    Rmw(MaskedDoc),
    Activate(ActivateDoc),
    Precondition(PreconditionDoc),
    Unlock(UnlockDoc),
    Delay(DelayDoc),
    SnapshotToggle(ToggleDoc),
}

impl StepDoc {
    /// The capability a profile using this step kind requires.
    pub const fn capability(&self) -> &'static str {
        match self {
            Self::Write(_) => "write",
            Self::WriteBlock(_) => "write-block",
            Self::Rmw(_) => "rmw",
            Self::Activate(_) => "activate",
            Self::Precondition(_) => "precondition",
            Self::Unlock(_) => "unlock",
            Self::Delay(_) => "delay",
            Self::SnapshotToggle(_) => "snapshot-toggle",
        }
    }
}

/// A field that must hold one of `values` before anything is written.
#[derive(Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(rename = "Precondition", optional_fields))]
#[serde(deny_unknown_fields)]
pub struct PreconditionDoc {
    pub register: u16,
    pub mask: Option<u16>,
    pub values: Vec<u16>,
}

/// A secret of the device's connection, written by name before the value; `finally` relocks.
#[derive(Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(rename = "Unlock"))]
#[serde(deny_unknown_fields)]
pub struct UnlockDoc {
    pub register: u16,
    #[serde(rename = "type")]
    pub kind: Kind,
    /// The secret's name on the connection; its value never appears in a profile.
    pub secret: String,
    /// Fixed writes that relock, run even after a failure.
    pub finally: Vec<RelockDoc>,
}

/// A switch over `target`: 1 stores its value and writes `locked`, 0 writes the stored value back.
#[derive(Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(rename = "SnapshotToggle"))]
#[serde(deny_unknown_fields)]
pub struct ToggleDoc {
    /// The key of the setting it locks.
    pub target: String,
    pub locked: f64,
}

/// Fixed words written from `register` in one request.
#[derive(Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(rename = "Relock"))]
#[serde(deny_unknown_fields)]
pub struct RelockDoc {
    pub register: u16,
    pub words: Vec<u16>,
}

/// The enable field written last, once the value is in place.
#[derive(Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(rename = "Activate"))]
#[serde(deny_unknown_fields)]
pub struct ActivateDoc {
    pub register: u16,
    pub value: u16,
}

/// The bits `mask` selects of `register`.
#[derive(Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(rename = "Masked"))]
#[serde(deny_unknown_fields)]
pub struct MaskedDoc {
    pub register: u16,
    pub mask: u16,
}

/// Where a write is read back: all of `register`, or the bits `mask` selects.
#[derive(Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(rename = "ReadBack", optional_fields))]
#[serde(deny_unknown_fields)]
pub struct ReadBackDoc {
    pub register: u16,
    pub mask: Option<u16>,
}

/// Registers written in one request from `register`, the value's words in place of `"value"`.
#[derive(Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(rename = "WriteBlock"))]
#[serde(deny_unknown_fields)]
pub struct BlockDoc {
    pub register: u16,
    #[cfg_attr(test, ts(type = "Array<number | \"value\">"))]
    pub words: Vec<BlockWord>,
}

#[derive(Deserialize)]
#[serde(untagged)]
pub enum BlockWord {
    Word(u16),
    Value(ValueMark),
}

#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ValueMark {
    Value,
}

#[derive(Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(rename = "Delay"))]
#[serde(deny_unknown_fields)]
pub struct DelayDoc {
    pub ms: u32,
}

#[derive(Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(rename = "Register"))]
#[serde(deny_unknown_fields)]
pub struct RegisterDoc {
    pub register: u16,
}

#[derive(Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(rename = "Quantity", optional_fields))]
#[serde(deny_unknown_fields)]
pub struct QuantityDoc {
    pub key: String,
    pub role: String,
    pub index: Option<u32>,
    pub register: Option<u16>,
    /// An `mqtt` topic under the connection's root; `{address}` stands for the device address.
    pub topic: Option<String>,
    #[serde(rename = "type")]
    pub kind: Option<Kind>,
    pub scale: Option<f64>,
    pub offset: Option<f64>,
    pub compute: Option<ExprDoc>,
    pub range: Option<Range>,
}

/// A register's type. Double words are low word first.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    U16,
    I16,
    U32,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[serde(deny_unknown_fields)]
pub struct Range {
    pub min: f64,
    pub max: f64,
}

/// A derived value over the keys of quantities declared earlier.
#[derive(Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(rename = "Expr", optional_fields))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub enum ExprDoc {
    Sum(Vec<String>),
    Diff([String; 2]),
    Combine {
        add: Vec<String>,
        #[serde(default)]
        #[cfg_attr(test, ts(optional, as = "Option<Vec<String>>"))]
        sub: Vec<String>,
    },
    Ratio {
        num: Vec<String>,
        den: Vec<String>,
        scale: Option<f64>,
    },
    Clamp {
        key: String,
        min: Option<f64>,
        max: Option<f64>,
    },
}
