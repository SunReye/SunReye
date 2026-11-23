//! What a sheet of either catalogue names, and why it is refused (ADRs 17, 27).

use serde::{Deserialize, Serialize};

use crate::datasheets::{BatteryEntry, InverterEntry};
use crate::modules::Datasheet;

/// The models one maker's datasheet prints: a module sheet's power classes, or its inverters and
/// batteries.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Sheet {
    /// A module sheet names its maker and series; an inverter or battery type names its own.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub maker: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub series: Option<String>,
    pub source: Source,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub modules: Vec<Datasheet>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub inverters: Vec<InverterEntry>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub batteries: Vec<BatteryEntry>,
}

impl Sheet {
    /// # Errors
    /// The sheet does not parse, or is refused.
    pub fn parse(json: &str) -> Result<Self, Invalid> {
        let sheet: Self = serde_json::from_str(json).map_err(|e| Invalid::Json(e.to_string()))?;
        sheet.check().map(|()| sheet)
    }

    /// # Errors
    /// The sheet names no source or model, a module sheet no maker or series, or an entry is
    /// refused.
    pub fn check(&self) -> Result<(), Invalid> {
        let source = &self.source;
        let blank = |text: &str| text.trim().is_empty();
        let unnamed = |text: &Option<String>| text.as_deref().is_none_or(blank);
        if [&source.title, &source.revision, &source.url]
            .iter()
            .any(|text| blank(text))
            || self.modules.is_empty() && self.inverters.is_empty() && self.batteries.is_empty()
            || !self.modules.is_empty() && (unnamed(&self.maker) || unnamed(&self.series))
        {
            return Err(Invalid::Source);
        }
        self.modules.iter().try_for_each(Datasheet::check)?;
        self.inverters.iter().try_for_each(InverterEntry::check)?;
        self.batteries.iter().try_for_each(BatteryEntry::check)
    }

    /// The first model whose profile link `served` does not know, by its profile id and
    /// variant.
    #[must_use]
    pub fn unlinked(&self, served: impl Fn(&str, Option<&str>) -> bool) -> Option<&str> {
        let inverters = self
            .inverters
            .iter()
            .map(|e| (&e.inverter.model, &e.profile));
        let batteries = self
            .batteries
            .iter()
            .map(|e| (&e.battery.model, &e.profile));
        inverters.chain(batteries).find_map(|(model, link)| {
            let link = link.as_ref()?;
            let known = served(&link.id, link.variant.as_deref());
            (!known).then_some(model.as_str())
        })
    }
}

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
    /// The sheet names no datasheet or no model, or a module sheet no maker or series.
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
