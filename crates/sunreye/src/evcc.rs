//! The `evcc` state topic's payload in the 3.x wire contract (`packages/contracts/src/evcc/types.ts`).
//! EVCC is consume-only (ADR 0005): the ingest publishes it, nothing writes back.

use serde::Serialize;

/// Where a loadpoint's live charge power comes from; absent on the wire means `measured`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ChargePowerSource {
    #[default]
    Measured,
    Estimated,
    Feedforward,
}

/// One loadpoint as the dashboard renders it; an unknown figure is `None`, not zero.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EvccLoadpoint {
    /// 1-based, as in EVCC's topics.
    pub index: u32,
    pub title: Option<String>,
    /// `off`, `pv`, `minpv` or `now`.
    pub mode: Option<String>,
    /// W, as EVCC last reported it.
    pub charge_power: f64,
    /// W, the estimator's view between EVCC's publishes.
    pub charge_power_live: f64,
    pub charge_power_source: ChargePowerSource,
    pub charging: bool,
    pub connected: bool,
    pub vehicle_soc: Option<f64>,
    /// km.
    pub vehicle_range: Option<f64>,
    pub vehicle_title: Option<String>,
    pub vehicle_name: Option<String>,
    /// Wh added this session.
    pub session_energy: Option<f64>,
    /// Wh still needed to reach the limit.
    pub charge_remaining_energy: Option<f64>,
    pub limit_soc: Option<f64>,
    /// The limit EVCC charges to, in %; `0` or `None` is no limit.
    pub effective_limit_soc: Option<f64>,
    pub vehicle_limit_soc: Option<f64>,
    /// EVCC is draining the house battery into the car.
    pub battery_boost: bool,
    pub battery_boost_limit: Option<f64>,
    pub vehicle_capacity_kwh: Option<f64>,
    pub phases_active: Option<u8>,
}

/// What the `evcc` topic retains.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EvccState {
    /// The broker is connected and EVCC reports itself online.
    pub reachable: bool,
    pub loadpoints: Vec<EvccLoadpoint>,
    /// Draw the EV off the house-load node.
    pub subtract_from_home: bool,
}
