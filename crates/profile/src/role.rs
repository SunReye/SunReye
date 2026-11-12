//! Role units, from ADR 4's table.

use serde::{Deserialize, Serialize};

use crate::Quantity;

/// The unit of a role's values, or of a setting's, written as its symbol.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub enum Unit {
    #[serde(rename = "W")]
    Watt,
    #[serde(rename = "kWh")]
    KilowattHour,
    #[serde(rename = "V")]
    Volt,
    #[serde(rename = "A")]
    Ampere,
    #[serde(rename = "Hz")]
    Hertz,
    #[serde(rename = "%")]
    Percent,
    #[serde(rename = "°C")]
    Celsius,
}

/// What a role's values are (ADR 4).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RoleKind {
    Measurement,
    /// A monotonic lifetime total.
    Counter,
    /// An enum.
    Status,
}

impl Quantity {
    /// The kind of the role it publishes; an extra or a role ADR 4 lacks is a measurement.
    #[must_use]
    pub fn kind(&self) -> RoleKind {
        match self.role.as_str() {
            "battery.mode" | "inverter.status" | "ev.connected" | "ev.charging" | "ev.mode"
            | "ev.battery.boost" => RoleKind::Status,
            "ev.session.energy" | "battery.cycles" => RoleKind::Counter,
            role if role.rsplit('.').next() == Some("total") => RoleKind::Counter,
            _ => RoleKind::Measurement,
        }
    }

    /// The unit of the role it publishes; none for a status, an extra or a role ADR 4 lacks.
    #[must_use]
    pub fn unit(&self) -> Option<Unit> {
        unit(&self.role)
    }
}

fn unit(role: &str) -> Option<Unit> {
    Some(match role {
        "pv.power"
        | "pv.mppt.power"
        | "pv.string.power"
        | "battery.power"
        | "grid.power"
        | "grid.phase.power"
        | "load.power"
        | "load.phase.power"
        | "backup.power"
        | "generator.power"
        | "inverter.power"
        | "ev.charge.power"
        | "grid.import.power"
        | "grid.export.power"
        | "self.consumption.power"
        | "self.supply.power" => Unit::Watt,
        "pv.energy.total"
        | "battery.capacity"
        | "battery.energy.charged.total"
        | "battery.energy.discharged.total"
        | "grid.energy.imported.total"
        | "grid.energy.exported.total"
        | "load.energy.total"
        | "backup.energy.total"
        | "generator.energy.total"
        | "ev.session.energy" => Unit::KilowattHour,
        "pv.mppt.voltage" | "battery.voltage" | "grid.phase.voltage" => Unit::Volt,
        "pv.mppt.current" | "battery.current" | "grid.phase.current" => Unit::Ampere,
        "grid.frequency" => Unit::Hertz,
        "battery.soc" | "ev.vehicle.soc" | "ev.limit.soc" => Unit::Percent,
        "battery.temperature" | "inverter.temperature" => Unit::Celsius,
        _ => return None,
    })
}
