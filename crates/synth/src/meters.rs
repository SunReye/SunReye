//! What each quantity of a device's profile reads from the plant, as its endpoint would decode it.

use sunreye_profile::{Quantity, RoleKind, Unit};

use crate::home::Now;
use crate::plant::Kind;

/// What a quantity reads from the plant.
#[derive(Debug, Clone, Copy, PartialEq)]
enum Source {
    MpptPower(usize),
    MpptVoltage(usize),
    MpptCurrent(usize),
    PvPower,
    PvEnergy,
    Output,
    Loss,
    Efficiency,
    InverterTemperature,
    BatteryPower,
    BatteryCharge,
    BatteryDischarge,
    BatterySoc,
    BatteryVoltage,
    BatteryCurrent,
    BatteryTemperature,
    BatteryCharged,
    BatteryDischarged,
    Grid,
    GridImport,
    GridExport,
    Imported,
    Exported,
    PhasePower(usize),
    PhaseVoltage(usize),
    PhaseCurrent(usize),
    OutputPhase(usize),
    OutputCurrent(usize),
    Frequency,
    Ups,
    UpsPhase(usize),
    UpsEnergy,
    UpsToday,
    HeatPump,
    HeatPumpPhase(usize),
    HeatPumpCurrent(usize),
    EvPower,
    EvSoc,
    EvSession,
    EvConnected,
    EvCharging,
    EvMode,
    EvLimit,
    Fixed(f64),
}

/// What one quantity of a device reads from the plant.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Meter {
    kind: Kind,
    source: Source,
}

impl Meter {
    /// `quantity` of a device of `kind`.
    #[must_use]
    pub fn new(kind: Kind, quantity: &Quantity) -> Self {
        Self {
            kind,
            source: source(kind, quantity),
        }
    }

    /// Its reading of the plant `now`; none where the device would read none.
    #[must_use]
    pub fn read(&self, now: &Now) -> Option<f64> {
        value(self.kind, self.source, now)
    }
}

/// The phase a role's 1-based `index` names.
fn phase(index: Option<u32>) -> usize {
    index
        .and_then(|i| usize::try_from(i).ok())
        .map_or(0, |i| i.saturating_sub(1).min(2))
}

/// Where a quantity's value comes from, by the device's kind and the quantity's role.
fn source(kind: Kind, quantity: &Quantity) -> Source {
    let (role, key) = (quantity.role.as_str(), quantity.key.as_str());
    let (role_kind, unit) = (quantity.kind(), quantity.unit());
    let p = phase(quantity.index);
    match kind {
        Kind::GridMeter => match role {
            "grid.power" => Source::Grid,
            "grid.phase.power" => Source::PhasePower(p),
            "grid.phase.voltage" => Source::PhaseVoltage(p),
            "grid.phase.current" => Source::PhaseCurrent(p),
            _ => fallback(role_kind, unit),
        },
        Kind::HeatPumpMeter => match role {
            "grid.power" => Source::HeatPump,
            "grid.phase.power" => Source::HeatPumpPhase(p),
            "grid.phase.voltage" => Source::PhaseVoltage(p),
            "grid.phase.current" => Source::HeatPumpCurrent(p),
            _ => fallback(role_kind, unit),
        },
        Kind::Wallbox => match role {
            "ev.charge.power" => Source::EvPower,
            "ev.vehicle.soc" => Source::EvSoc,
            "ev.session.energy" => Source::EvSession,
            "ev.connected" => Source::EvConnected,
            "ev.charging" => Source::EvCharging,
            "ev.mode" => Source::EvMode,
            "ev.limit.soc" => Source::EvLimit,
            _ => Source::Fixed(0.0),
        },
        Kind::Inverter(_) => inverter(role, key, p, role_kind, unit),
    }
}

fn inverter(role: &str, key: &str, p: usize, role_kind: RoleKind, unit: Option<Unit>) -> Source {
    match role {
        "pv.mppt.power" => Source::MpptPower(p),
        "pv.mppt.voltage" => Source::MpptVoltage(p),
        "pv.mppt.current" => Source::MpptCurrent(p),
        "pv.power" => Source::PvPower,
        "pv.energy.total" => Source::PvEnergy,
        "inverter.power" => Source::Output,
        "inverter.loss.power" => Source::Loss,
        "inverter.efficiency" => Source::Efficiency,
        "inverter.temperature" => Source::InverterTemperature,
        "inverter.status" => Source::Fixed(2.0),
        "battery.power" => Source::BatteryPower,
        "battery.soc" => Source::BatterySoc,
        "battery.voltage" => Source::BatteryVoltage,
        "battery.current" => Source::BatteryCurrent,
        "battery.temperature" => Source::BatteryTemperature,
        "battery.energy.charged.total" => Source::BatteryCharged,
        "battery.energy.discharged.total" => Source::BatteryDischarged,
        "grid.power" => Source::Grid,
        "grid.phase.voltage" => Source::PhaseVoltage(p),
        "grid.phase.power" => Source::PhasePower(p),
        "grid.phase.current" => Source::PhaseCurrent(p),
        "grid.energy.imported.total" => Source::Imported,
        "grid.energy.exported.total" => Source::Exported,
        "load.power" => Source::Ups,
        "load.phase.power" => Source::UpsPhase(p),
        "load.energy.total" => Source::UpsEnergy,
        _ => extra(key, role_kind, unit),
    }
}

/// A profile's own quantities, by their key.
fn extra(key: &str, role_kind: RoleKind, unit: Option<Unit>) -> Source {
    let line = ["l1", "l2", "l3"]
        .iter()
        .position(|l| key.contains(&format!(".{l}.")))
        .unwrap_or(0);
    match key {
        "grid.import_power" => Source::GridImport,
        "grid.export_power" => Source::GridExport,
        "battery.charge_power" => Source::BatteryCharge,
        "battery.discharge_power" => Source::BatteryDischarge,
        "ac.total_internal_power" => Source::Grid,
        "ac.ups.daily_energy" => Source::UpsToday,
        _ if key.contains("generator") || key.starts_with("battery.2") => Source::Fixed(0.0),
        _ if key.contains("ct.internal_current") || key.contains("ct.external_current") => {
            Source::PhaseCurrent(line)
        }
        _ if key.contains("ct.") => Source::PhasePower(line),
        _ if key.starts_with("ac.ups.") && key.ends_with(".voltage") => Source::PhaseVoltage(line),
        _ if key.starts_with("ac.") && key.rsplit('.').next() == Some("current") => {
            Source::OutputCurrent(line)
        }
        _ if key.starts_with("ac.") && key.rsplit('.').next() == Some("power") => {
            Source::OutputPhase(line)
        }
        _ if key == "ac.temperature" => Source::InverterTemperature,
        _ => fallback(role_kind, unit),
    }
}

const fn fallback(role_kind: RoleKind, unit: Option<Unit>) -> Source {
    match (role_kind, unit) {
        (RoleKind::Measurement, Some(Unit::Volt)) => Source::PhaseVoltage(0),
        (RoleKind::Measurement, Some(Unit::Hertz)) => Source::Frequency,
        _ => Source::Fixed(0.0),
    }
}

/// The value `source` reads from the plant `now`, as device `kind` measures it; none where the
/// device would read none.
#[expect(clippy::too_many_lines, reason = "one arm per source")]
fn value(kind: Kind, source: Source, now: &Now) -> Option<f64> {
    let place = match kind {
        Kind::Inverter(place) => place,
        Kind::GridMeter | Kind::HeatPumpMeter | Kind::Wallbox => 0,
    };
    let inverter = now.inverters.get(place)?;
    let hybrid = place == 0;
    let battery = |v: f64| if hybrid { v } else { 0.0 };
    let input = |i: usize| inverter.inputs.get(i).copied().unwrap_or_default();
    let voltage = |p: usize| now.voltages.get(p).copied().unwrap_or(230.0);
    // A single-phase circuit would show; these loads are balanced.
    let share = |watts: f64, _: usize| watts / 3.0;
    Some(match source {
        Source::MpptPower(i) => input(i).power,
        Source::MpptVoltage(i) => input(i).voltage,
        Source::MpptCurrent(i) => input(i).current,
        Source::PvPower => inverter.pv,
        Source::PvEnergy => inverter.energy,
        Source::Output => inverter.output,
        Source::Loss => inverter.pv - inverter.output,
        Source::Efficiency => {
            if inverter.pv <= 0.0 {
                return None;
            }
            inverter.output / inverter.pv * 100.0
        }
        Source::InverterTemperature => inverter.temperature,
        Source::BatteryPower => battery(now.battery.power),
        Source::BatteryCharge => battery(now.battery.power.max(0.0)),
        Source::BatteryDischarge => battery((-now.battery.power).max(0.0)),
        Source::BatterySoc => battery(now.battery.soc.round()),
        Source::BatteryVoltage => battery(now.battery.voltage),
        Source::BatteryCurrent => battery(now.battery.current),
        Source::BatteryTemperature => battery(now.battery.temperature),
        Source::BatteryCharged => battery(now.battery.charged),
        Source::BatteryDischarged => battery(now.battery.discharged),
        Source::Grid => now.grid,
        Source::GridImport => now.grid.max(0.0),
        Source::GridExport => (-now.grid).max(0.0),
        Source::Imported => now.imported,
        Source::Exported => now.exported,
        Source::PhasePower(p) => now.phases.get(p).copied()?,
        Source::PhaseVoltage(p) => voltage(p),
        Source::PhaseCurrent(p) => now.phases.get(p)?.abs() / voltage(p),
        Source::OutputPhase(_) => inverter.output / 3.0,
        Source::OutputCurrent(p) => inverter.output / 3.0 / voltage(p),
        Source::Frequency => now.frequency,
        Source::Ups => battery(now.ups),
        Source::UpsPhase(p) => battery(share(now.ups, p)),
        Source::UpsEnergy => battery(now.ups_energy),
        Source::UpsToday => battery(now.ups_today),
        Source::HeatPump => now.heat_pump,
        Source::HeatPumpPhase(p) => share(now.heat_pump, p),
        Source::HeatPumpCurrent(p) => share(now.heat_pump, p) / voltage(p),
        Source::EvPower => now.ev.power,
        Source::EvSoc => now.ev.soc.round(),
        Source::EvSession => now.ev.session,
        Source::EvConnected => f64::from(u8::from(now.ev.connected)),
        Source::EvCharging => f64::from(u8::from(now.ev.charging)),
        Source::EvMode => now.ev.mode,
        Source::EvLimit => now.ev.limit,
        Source::Fixed(value) => value,
    })
}
