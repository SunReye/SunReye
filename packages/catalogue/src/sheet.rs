//! What a sheet of either catalogue names, and why it is refused (ADRs 17, 27).

use serde::{Deserialize, Serialize};

/// The maker's datasheet every value of a sheet was copied from.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Source {
    /// As printed on the datasheet.
    pub title: String,
    /// The revision or date printed on the datasheet.
    pub revision: String,
    pub url: String,
    /// Why this edition was chosen, where it matters.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

/// Why a sheet or an entry is refused.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Invalid {
    /// The sheet does not parse, by the parser's message.
    Json(String),
    /// The sheet names no datasheet, or no model.
    Source,
    /// The named model has a value out of its range or inconsistent with another, by its JSON
    /// pointer below the entry without the leading `/`.
    Value { model: String, field: String },
}

impl std::fmt::Display for Invalid {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Json(error) => write!(f, "catalogue sheet: {error}"),
            Self::Source => f.write_str("catalogue sheet names no datasheet or model"),
            Self::Value { model, field } => {
                write!(f, "catalogue: {model} has {field} out of range")
            }
        }
    }
}

impl std::error::Error for Invalid {}
