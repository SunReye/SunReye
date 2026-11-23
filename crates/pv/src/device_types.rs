//! Inverter and battery types (ADR 27): one model's datasheet values, which a device carries a
//! copy of. A field this schema does not know is refused, so an older core never misreads a
//! newer plan (ADR 25).

use serde::{Deserialize, Serialize};

use crate::{AcSide, MpptLimits};

/// One inverter model's datasheet values.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InverterType {
    pub maker: String,
    pub model: String,
    /// The country of the maker's registered seat, ISO 3166-1 alpha-2.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub maker_country: Option<String>,
    /// The country of manufacture, ISO 3166-1 alpha-2, only where the datasheet states one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub made_in: Option<String>,
    /// Volts.
    pub max_input_voltage: f64,
    /// Watts of AC output at its rating.
    pub ac_rating: f64,
    /// The European weighted efficiency, in %.
    pub efficiency: f64,
    /// The MPPT inputs, numbered from 1 in order, as `pv.mppt.*` indices.
    pub inputs: Vec<MpptInput>,
}

/// One MPPT input's limits on a datasheet.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MpptInput {
    /// Amperes.
    pub max_current: f64,
    /// The voltage window, in volts.
    pub min_voltage: f64,
    pub max_voltage: f64,
    /// Volts.
    pub start_voltage: f64,
}

/// One battery model's datasheet values.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BatteryType {
    pub maker: String,
    pub model: String,
    /// The country of the maker's registered seat, ISO 3166-1 alpha-2.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub maker_country: Option<String>,
    /// The country of manufacture, ISO 3166-1 alpha-2, only where the datasheet states one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub made_in: Option<String>,
    /// Watt-hours.
    pub usable_capacity: f64,
    /// Watts.
    pub charge_power: f64,
    pub discharge_power: f64,
    /// In %.
    pub round_trip_efficiency: f64,
}

impl InverterType {
    /// Each MPPT input's limits, in order.
    #[must_use]
    pub fn limits(&self) -> Vec<MpptLimits> {
        self.inputs
            .iter()
            .map(|i| MpptLimits {
                max_current: i.max_current,
                min_voltage: i.min_voltage,
                max_voltage: i.max_voltage,
                start_voltage: i.start_voltage,
            })
            .collect()
    }

    /// Its AC rating and efficiency, for a year's run.
    #[must_use]
    pub const fn ac_side(&self) -> AcSide {
        AcSide {
            rating: self.ac_rating,
            efficiency: self.efficiency,
        }
    }

    /// The first value out of its physical range, as a JSON pointer below the type without its
    /// leading `/`.
    #[must_use]
    pub fn unphysical(&self) -> Option<String> {
        let named = origin(
            &self.maker,
            &self.model,
            self.maker_country.as_deref(),
            self.made_in.as_deref(),
        )
        .or_else(|| {
            [
                ("maxInputVoltage", positive(self.max_input_voltage)),
                ("acRating", positive(self.ac_rating)),
                ("efficiency", percent(self.efficiency)),
                ("inputs", !self.inputs.is_empty()),
            ]
            .into_iter()
            .find_map(|(field, within)| (!within).then_some(field))
        });
        if let Some(field) = named {
            return Some(field.to_owned());
        }
        self.inputs.iter().enumerate().find_map(|(at, input)| {
            let field = input.unphysical(self.max_input_voltage)?;
            Some(format!("inputs/{at}/{field}"))
        })
    }
}

impl MpptInput {
    /// Its window lies inside the inverter's maximum DC input voltage, and it starts within it.
    fn unphysical(&self, max_input_voltage: f64) -> Option<&'static str> {
        [
            ("maxCurrent", positive(self.max_current)),
            (
                "minVoltage",
                positive(self.min_voltage) && self.min_voltage < self.max_voltage,
            ),
            (
                "maxVoltage",
                positive(self.max_voltage) && self.max_voltage <= max_input_voltage,
            ),
            (
                "startVoltage",
                positive(self.start_voltage) && self.start_voltage <= self.max_voltage,
            ),
        ]
        .into_iter()
        .find_map(|(field, within)| (!within).then_some(field))
    }
}

impl BatteryType {
    /// The first value out of its physical range, by its field's name.
    #[must_use]
    pub fn unphysical(&self) -> Option<String> {
        origin(
            &self.maker,
            &self.model,
            self.maker_country.as_deref(),
            self.made_in.as_deref(),
        )
        .or_else(|| {
            [
                ("usableCapacity", positive(self.usable_capacity)),
                ("chargePower", positive(self.charge_power)),
                ("dischargePower", positive(self.discharge_power)),
                ("roundTripEfficiency", percent(self.round_trip_efficiency)),
            ]
            .into_iter()
            .find_map(|(field, within)| (!within).then_some(field))
        })
        .map(str::to_owned)
    }
}

/// The first of a type's names that is blank or a country that is no ISO 3166-1 alpha-2 code.
fn origin(
    maker: &str,
    model: &str,
    maker_country: Option<&str>,
    made_in: Option<&str>,
) -> Option<&'static str> {
    let country = |c: Option<&str>| {
        c.is_none_or(|c| c.len() == 2 && c.bytes().all(|b| b.is_ascii_uppercase()))
    };
    [
        ("maker", !maker.trim().is_empty()),
        ("model", !model.trim().is_empty()),
        ("makerCountry", country(maker_country)),
        ("madeIn", country(made_in)),
    ]
    .into_iter()
    .find_map(|(field, within)| (!within).then_some(field))
}

fn positive(value: f64) -> bool {
    value.is_finite() && value > 0.0
}

fn percent(value: f64) -> bool {
    value.is_finite() && value > 0.0 && value <= 100.0
}
