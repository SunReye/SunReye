//! Role units, from ADR 4's table.

use crate::Quantity;

/// The unit of a role's values.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Unit {
    Watt,
    KilowattHour,
    Volt,
    Ampere,
    Hertz,
    Percent,
    Celsius,
}

impl Quantity {
    /// The unit of the role it publishes; none for a status, an extra or a role ADR 4 lacks.
    #[must_use]
    pub fn unit(&self) -> Option<Unit> {
        unit(&self.role)
    }
}

fn unit(role: &str) -> Option<Unit> {
    Some(match role {
        "pv.power" | "pv.mppt.power" | "pv.string.power" | "battery.power" | "grid.power"
        | "grid.phase.power" | "load.power" | "backup.power" | "generator.power"
        | "ev.charge.power" => Unit::Watt,
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
        "battery.soc" | "ev.vehicle.soc" => Unit::Percent,
        "battery.temperature" => Unit::Celsius,
        _ => return None,
    })
}
