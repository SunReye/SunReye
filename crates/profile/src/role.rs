//! Role units, from ADR 4's table.

use serde::{Deserialize, Serialize};

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
    #[serde(rename = "h")]
    Hour,
    /// Dimensionless by the author's choice: every change is stored.
    #[serde(rename = "none")]
    Dimensionless,
}

/// What a quantity's values are (ADR 4): a named role's kind, or the one an extra declares.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[serde(rename_all = "lowercase")]
pub enum RoleKind {
    Measurement,
    /// A monotonic lifetime total.
    Counter,
    /// An enum.
    Status,
    /// A value the device holds, such as a configured limit: stored on every change.
    Held,
}

/// Where a quantity's readings go (ADR 3).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[serde(rename_all = "lowercase")]
pub enum StorageClass {
    /// History: change points and rollups.
    #[default]
    Series,
    /// `none` in a profile: published live, never written.
    #[serde(rename = "none")]
    NoHistory,
}

/// The kind of a named role; a role ADR 4 lacks is a measurement.
pub fn kind(role: &str) -> RoleKind {
    match role {
        "battery.mode" | "inverter.status" | "ev.connected" | "ev.charging" | "ev.mode"
        | "ev.battery.boost" => RoleKind::Status,
        "ev.session.energy" | "battery.cycles" => RoleKind::Counter,
        role if role.rsplit('.').next() == Some("total") => RoleKind::Counter,
        _ => RoleKind::Measurement,
    }
}

/// The unit of a named role; none for a status or a role ADR 4 lacks.
pub fn unit(role: &str) -> Option<Unit> {
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
        | "inverter.loss.power"
        | "ev.charge.power"
        | "battery.charge.power"
        | "battery.discharge.power"
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
        "battery.soc" | "ev.vehicle.soc" | "ev.limit.soc" | "inverter.efficiency" => Unit::Percent,
        "battery.temperature" | "inverter.temperature" => Unit::Celsius,
        _ => return None,
    })
}
