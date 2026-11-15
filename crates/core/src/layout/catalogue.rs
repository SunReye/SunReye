//! The module catalogue (ADR 17): module types' datasheets bundled with the core, each sheet
//! naming the maker's datasheet it was copied from. Picking an entry copies it into a module
//! type, so a layout never depends on the catalogue.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::Datasheet;

/// The sheets, one per maker's datasheet, as `crates/core/catalogue/` holds them at build time.
const BUNDLED: &[&str] = &[
    include_str!("../../catalogue/aiko-neostar-2s-plus-mah54db.json"),
    include_str!("../../catalogue/ja-solar-deepblue-4-0-jam54d40-gb.json"),
    include_str!("../../catalogue/ja-solar-deepblue-4-0-jam54d40-lb.json"),
    include_str!("../../catalogue/ja-solar-deepblue-4-0-jam54d40-mb.json"),
    include_str!("../../catalogue/ja-solar-deepblue-4-0-jam54d41-lb.json"),
    include_str!("../../catalogue/longi-hi-mo-6-explorer-lr5-54htb.json"),
    include_str!("../../catalogue/longi-hi-mo-6-explorer-lr5-54hth.json"),
    include_str!("../../catalogue/longi-hi-mo-6-scientist-lr5-54htb.json"),
    include_str!("../../catalogue/longi-hi-mo-6-scientist-lr5-54hth.json"),
    include_str!("../../catalogue/longi-hi-mo-x6-explorer-lr5-54htb.json"),
    include_str!("../../catalogue/longi-hi-mo-x6-explorer-lr5-54hth.json"),
    include_str!("../../catalogue/trina-solar-vertex-s-plus-neg9r-28.json"),
];

/// The power classes one maker's datasheet prints.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Sheet {
    pub maker: String,
    pub series: String,
    pub source: Source,
    pub modules: Vec<Datasheet>,
}

/// The maker's datasheet every value of a sheet was copied from.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
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

#[derive(Debug)]
pub enum Invalid {
    Json(serde_json::Error),
    /// It names no datasheet, or no module.
    Source,
    /// The named module has a value out of its range.
    Value(String),
}

impl std::fmt::Display for Invalid {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Json(error) => write!(f, "module catalogue sheet: {error}"),
            Self::Source => f.write_str("module catalogue sheet names no datasheet or module"),
            Self::Value(name) => write!(f, "module catalogue: {name} has a value out of range"),
        }
    }
}

/// # Errors
/// The sheet does not parse, names no source or module, or a value is out of its range.
pub fn parse(json: &str) -> Result<Sheet, Invalid> {
    let sheet: Sheet = serde_json::from_str(json).map_err(Invalid::Json)?;
    let source = &sheet.source;
    if [&source.title, &source.revision, &source.url]
        .iter()
        .any(|text| text.trim().is_empty())
        || sheet.modules.is_empty()
    {
        return Err(Invalid::Source);
    }
    if let Some(module) = sheet.modules.iter().find(|module| !plausible(module)) {
        return Err(Invalid::Value(module.name.clone()));
    }
    Ok(sheet)
}

/// Whether a datasheet's values hang together, so a slip in copying one shows.
fn plausible(d: &Datasheet) -> bool {
    let point = d.vmp * d.imp;
    let module = (0.2..=3.0).contains(&d.width) && (0.2..=3.0).contains(&d.height);
    super::unphysical(d).is_none()
        && d.vmp < d.voc
        && d.imp < d.isc
        // Datasheets print Vmp and Imp rounded, so their product strays from Pmax a little.
        && (point - d.pmax).abs() <= 0.02 * d.pmax
        && (-1.0..0.0).contains(&d.power_coefficient)
        && (-1.0..0.0).contains(&d.voltage_coefficient)
        && (0.0..1.0).contains(&d.current_coefficient)
        && module
        && (1..=6).contains(&d.bypass_diodes)
}

/// # Errors
/// A bundled sheet is refused; a test loads them all.
pub fn bundled() -> Result<Vec<Sheet>, Invalid> {
    BUNDLED.iter().map(|json| parse(json)).collect()
}

#[cfg(test)]
mod tests;
