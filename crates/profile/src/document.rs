//! The profile file as written. Unknown fields are refused: a field this build does not know may
//! change what a register means.

use serde::Deserialize;

/// Read first, so a profile of another schema is refused by its number, not by its fields.
#[derive(Deserialize)]
pub struct Header {
    pub schema: u32,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProfileDoc {
    #[expect(dead_code, reason = "checked through Header")]
    pub schema: u32,
    pub id: String,
    pub name: String,
    pub manufacturer: String,
    pub version: String,
    pub requires: Vec<String>,
    pub quantities: Vec<QuantityDoc>,
    pub inverter: Option<crate::Inverter>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct QuantityDoc {
    pub key: String,
    pub role: String,
    pub index: Option<u32>,
    pub register: Option<u16>,
    #[serde(rename = "type")]
    pub kind: Option<Kind>,
    pub scale: Option<f64>,
    pub offset: Option<f64>,
    pub compute: Option<ExprDoc>,
    pub range: Option<Range>,
}

/// A register's type. Double words are low word first.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    U16,
    I16,
    U32,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Range {
    pub min: f64,
    pub max: f64,
}

/// A derived value over the keys of quantities declared earlier.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub enum ExprDoc {
    Sum(Vec<String>),
    Diff([String; 2]),
    Combine {
        add: Vec<String>,
        #[serde(default)]
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
