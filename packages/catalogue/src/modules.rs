//! The module catalogue (ADR 17).
//!
//! Module types' datasheets bundled with the core, each sheet naming the maker's datasheet it was
//! copied from. Picking an entry copies it into a module type, so a layout never depends on the
//! catalogue.

use serde::{Deserialize, Serialize};

use crate::{Invalid, Source};

/// The sheets, one per maker's datasheet, as `modules/` holds them at build time.
const BUNDLED: &[&str] = &[
    include_str!("../modules/aiko-neostar-2s-plus-mah54db.json"),
    include_str!("../modules/ja-solar-deepblue-4-0-jam54d40-gb.json"),
    include_str!("../modules/ja-solar-deepblue-4-0-jam54d40-lb.json"),
    include_str!("../modules/ja-solar-deepblue-4-0-jam54d40-mb.json"),
    include_str!("../modules/ja-solar-deepblue-4-0-jam54d41-lb.json"),
    include_str!("../modules/longi-hi-mo-6-explorer-lr5-54htb.json"),
    include_str!("../modules/longi-hi-mo-6-explorer-lr5-54hth.json"),
    include_str!("../modules/longi-hi-mo-6-scientist-lr5-54htb.json"),
    include_str!("../modules/longi-hi-mo-6-scientist-lr5-54hth.json"),
    include_str!("../modules/longi-hi-mo-x6-explorer-lr5-54htb.json"),
    include_str!("../modules/longi-hi-mo-x6-explorer-lr5-54hth.json"),
    include_str!("../modules/trina-solar-vertex-s-plus-neg9r-28.json"),
];

/// A PV module model's datasheet values.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct Datasheet {
    pub name: String,
    /// Watts at standard test conditions.
    pub pmax: f64,
    /// Volts and amperes at the maximum power point.
    pub vmp: f64,
    pub imp: f64,
    /// Open-circuit volts and short-circuit amperes.
    pub voc: f64,
    pub isc: f64,
    /// Of Pmax, Voc and Isc, in %/K.
    pub power_coefficient: f64,
    pub voltage_coefficient: f64,
    pub current_coefficient: f64,
    /// Metres.
    pub width: f64,
    pub height: f64,
    pub bypass_diodes: u8,
}

impl Datasheet {
    /// The values the `pv` model uses.
    #[must_use]
    pub const fn model(&self) -> sunreye_pv::ModuleType {
        sunreye_pv::ModuleType {
            vmp: self.vmp,
            imp: self.imp,
            voc: self.voc,
            isc: self.isc,
            voltage_coefficient: self.voltage_coefficient,
            current_coefficient: self.current_coefficient,
            width: self.width,
            height: self.height,
            bypass_diodes: self.bypass_diodes,
        }
    }

    /// The first value out of its physical range, by its field's name.
    #[must_use]
    pub fn unphysical(&self) -> Option<&'static str> {
        let positive = [
            ("pmax", self.pmax),
            ("vmp", self.vmp),
            ("imp", self.imp),
            ("voc", self.voc),
            ("isc", self.isc),
            ("width", self.width),
            ("height", self.height),
        ];
        let coefficients = [
            ("powerCoefficient", self.power_coefficient),
            ("voltageCoefficient", self.voltage_coefficient),
            ("currentCoefficient", self.current_coefficient),
        ];
        let bad = positive
            .into_iter()
            .find(|(_, v)| !(v.is_finite() && *v > 0.0));
        bad.or_else(|| coefficients.into_iter().find(|(_, v)| !v.is_finite()))
            .map(|(field, _)| field)
    }

    /// The first value out of its range or inconsistent with another, by its field's name: what a
    /// datasheet would not print, so a slip in copying one shows. A module typed outside the
    /// catalogue is checked so too.
    #[must_use]
    pub fn implausible(&self) -> Option<&'static str> {
        // Datasheets print Vmp and Imp rounded, so their product strays from Pmax a little.
        let point = self.vmp * self.imp;
        let size = |metres: f64| (0.2..=3.0).contains(&metres);
        self.unphysical().or_else(|| {
            [
                ("vmp", self.vmp < self.voc),
                ("imp", self.imp < self.isc),
                ("pmax", (point - self.pmax).abs() <= 0.02 * self.pmax),
                (
                    "powerCoefficient",
                    (-1.0..0.0).contains(&self.power_coefficient),
                ),
                (
                    "voltageCoefficient",
                    (-1.0..0.0).contains(&self.voltage_coefficient),
                ),
                (
                    "currentCoefficient",
                    (0.0..1.0).contains(&self.current_coefficient),
                ),
                ("width", size(self.width)),
                ("height", size(self.height)),
                ("bypassDiodes", (1..=6).contains(&self.bypass_diodes)),
            ]
            .into_iter()
            .find_map(|(field, within)| (!within).then_some(field))
        })
    }
}

/// The power classes one maker's datasheet prints.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Sheet {
    pub maker: String,
    pub series: String,
    pub source: Source,
    pub modules: Vec<Datasheet>,
}

/// # Errors
/// The sheet does not parse, names no source or module, or a value is out of its range.
pub fn parse(json: &str) -> Result<Sheet, Invalid> {
    let sheet: Sheet = serde_json::from_str(json).map_err(|e| Invalid::Json(e.to_string()))?;
    let source = &sheet.source;
    if [&source.title, &source.revision, &source.url]
        .iter()
        .any(|text| text.trim().is_empty())
        || sheet.modules.is_empty()
    {
        return Err(Invalid::Source);
    }
    for module in &sheet.modules {
        if let Some(field) = module.implausible() {
            return Err(Invalid::Value {
                model: module.name.clone(),
                field: field.to_owned(),
            });
        }
    }
    Ok(sheet)
}

/// # Errors
/// A bundled sheet is refused; a test loads them all.
pub fn bundled() -> Result<Vec<Sheet>, Invalid> {
    BUNDLED.iter().map(|json| parse(json)).collect()
}
