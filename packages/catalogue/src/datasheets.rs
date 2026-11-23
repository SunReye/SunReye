//! The datasheet catalogue's format and checks (ADR 27).
//!
//! Inverter and battery types copied from a maker's datasheet, under the module catalogue's rules
//! (ADR 17). This repository holds the format; the collected entries are `SunReye Plan`'s
//! (ADR 25).

use serde::{Deserialize, Serialize};

use sunreye_pv::{BatteryType, InverterType, MpptInput};

use crate::{Invalid, Source};

/// The models one maker's datasheet prints.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Sheet {
    pub source: Source,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub inverters: Vec<InverterEntry>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub batteries: Vec<BatteryEntry>,
}

/// One inverter model: the type picking it adds, and the profile that reads it, where one exists.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InverterEntry {
    pub inverter: InverterType,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub profile: Option<ProfileLink>,
}

/// One battery model: the type picking it adds, and the profile that reads it, where one exists.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BatteryEntry {
    pub battery: BatteryType,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub profile: Option<ProfileLink>,
}

/// The profile, and its variant where the family has one per model (ADR 5), that reads an
/// entry's model.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProfileLink {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub variant: Option<String>,
}

impl Sheet {
    /// # Errors
    /// The sheet names no source or model, or an entry is refused.
    pub fn check(&self) -> Result<(), Invalid> {
        let source = &self.source;
        if [&source.title, &source.revision, &source.url]
            .iter()
            .any(|text| text.trim().is_empty())
            || self.inverters.is_empty() && self.batteries.is_empty()
        {
            return Err(Invalid::Source);
        }
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

impl ProfileLink {
    /// A blank id, or a variant id that is no profile's (ADR 5).
    fn malformed(&self) -> Option<String> {
        let variant = |v: &str| {
            (1..=16).contains(&v.len())
                && v.bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        };
        let field = if self.id.trim().is_empty() {
            "id"
        } else if !self.variant.as_deref().is_none_or(variant) {
            "variant"
        } else {
            return None;
        };
        Some(format!("profile/{field}"))
    }
}

impl InverterEntry {
    /// # Errors
    /// A value is out of its range or inconsistent with another.
    pub fn check(&self) -> Result<(), Invalid> {
        let t = &self.inverter;
        let field = seat(t.maker_country.as_ref())
            .or_else(|| t.unphysical())
            .or_else(|| implausible_inverter(t))
            .map(|field| format!("inverter/{field}"))
            .or_else(|| self.profile.as_ref()?.malformed());
        refuse(&t.model, field)
    }
}

impl BatteryEntry {
    /// # Errors
    /// A value is out of its range or inconsistent with another.
    pub fn check(&self) -> Result<(), Invalid> {
        let t = &self.battery;
        let field = seat(t.maker_country.as_ref())
            .or_else(|| t.unphysical())
            .or_else(|| implausible_battery(t))
            .map(|field| format!("battery/{field}"))
            .or_else(|| self.profile.as_ref()?.malformed());
        refuse(&t.model, field)
    }
}

/// A type may leave its maker's seat out; a catalogue entry names it.
fn seat(maker_country: Option<&String>) -> Option<String> {
    maker_country.is_none().then(|| "makerCountry".to_owned())
}

/// The first value of a physical inverter type that a datasheet would not print, so a slip in
/// copying one shows: kilowatts for watts, a fraction for %.
fn implausible_inverter(t: &InverterType) -> Option<String> {
    let named = [
        // The low-voltage directive ends at 1500 V DC.
        (
            "maxInputVoltage",
            (30.0..=1500.0).contains(&t.max_input_voltage),
        ),
        ("acRating", (100.0..=500_000.0).contains(&t.ac_rating)),
        ("efficiency", (80.0..100.0).contains(&t.efficiency)),
    ]
    .into_iter()
    .find_map(|(field, within)| (!within).then(|| field.to_owned()));
    named.or_else(|| {
        let current = |i: &MpptInput| (1.0..=100.0).contains(&i.max_current);
        let at = t.inputs.iter().position(|i| !current(i))?;
        Some(format!("inputs/{at}/maxCurrent"))
    })
}

/// The first value of a physical battery type that a datasheet would not print.
fn implausible_battery(t: &BatteryType) -> Option<String> {
    // Charged or discharged in 15 minutes to 20 hours.
    let rate = |power: f64| {
        (100.0..=1_000_000.0).contains(&power)
            && (0.05..=4.0).contains(&(power / t.usable_capacity))
    };
    [
        (
            "usableCapacity",
            (100.0..=2_000_000.0).contains(&t.usable_capacity),
        ),
        ("chargePower", rate(t.charge_power)),
        ("dischargePower", rate(t.discharge_power)),
        (
            "roundTripEfficiency",
            (70.0..100.0).contains(&t.round_trip_efficiency),
        ),
    ]
    .into_iter()
    .find_map(|(field, within)| (!within).then(|| field.to_owned()))
}

fn refuse(model: &str, field: Option<String>) -> Result<(), Invalid> {
    field.map_or(Ok(()), |field| {
        Err(Invalid::Value {
            model: model.to_owned(),
            field,
        })
    })
}
