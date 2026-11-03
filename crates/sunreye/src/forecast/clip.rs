//! The usable view: PV serves the house, the surplus charges the battery, the grid takes what fits under the
//! feed-in cap, the rest is curtailed. Where PV falls short the battery serves the house down to its floor.

use super::{ForecastConfig, HOUR_MS, Point, SimInputs, Slots};

/// Limits one slot runs under; infinite where nothing binds.
#[derive(Debug, Clone, Copy)]
struct Caps {
    max_output_w: f64,
    battery_kwh: f64,
    max_charge_w: f64,
    floor_kwh: f64,
}

impl Caps {
    fn of(config: &ForecastConfig) -> Self {
        let battery_kwh = config.battery.as_ref().map_or(0.0, |b| b.usable_kwh);
        Self {
            max_output_w: config.max_output_w.unwrap_or(f64::INFINITY),
            battery_kwh,
            max_charge_w: config.battery.as_ref().and_then(|b| b.max_charge_w).unwrap_or(f64::INFINITY),
            floor_kwh: battery_kwh * (config.battery.as_ref().map_or(0.0, |b| b.min_soc) / 100.0),
        }
    }

    /// Clipping counts a positive capacity as a battery (3.x `solar-forecast.ts` `> 0`).
    fn has_battery(&self) -> bool {
        self.battery_kwh > 0.0
    }

    /// The past-slot rule counts only exactly zero as no battery (3.x `=== 0`), unlike `has_battery`.
    fn no_battery(&self) -> bool {
        self.battery_kwh == 0.0
    }

    fn clip(&self) -> bool {
        self.max_output_w < f64::INFINITY || self.has_battery()
    }
}

/// Where one slot's PV went, W.
#[derive(Debug, Clone, Copy)]
struct Flows {
    charge: f64,
    discharge: f64,
    curtailed: f64,
}

/// One slot of the flow; a zero-width slot moves no battery energy.
fn flow_step(pv_w: f64, load_w: f64, hours: f64, caps: &Caps, soc_kwh: f64) -> Flows {
    let pv = pv_w.max(0.0);
    let load = load_w.max(0.0);
    let surplus_w = (pv - load).max(0.0);
    let fits_w = if hours > 0.0 { ((caps.battery_kwh - soc_kwh).max(0.0) * 1000.0) / hours } else { 0.0 };
    let charge_w = caps.max_charge_w.min(surplus_w).min(fits_w).max(0.0);
    let sellable_w = surplus_w - charge_w;
    let export_w = sellable_w.min(caps.max_output_w).max(0.0);
    let deficit_w = (load - pv).max(0.0);
    let drainable_w = if hours > 0.0 { ((soc_kwh - caps.floor_kwh).max(0.0) * 1000.0) / hours } else { 0.0 };
    Flows { charge: charge_w, discharge: deficit_w.min(drainable_w), curtailed: sellable_w - export_w }
}

/// The battery's state as the sim walks the slots.
#[derive(Debug)]
struct Sim {
    caps: Caps,
    load_w: f64,
    soc_kwh: f64,
    /// Past slots are simulated: their battery state is measured (day-start SOC) or irrelevant (no battery).
    past: bool,
    /// Measured live SOC, %, that replaces the simulated one at the first slot not yet over.
    reseed_pct: Option<f64>,
}

impl Sim {
    fn new(config: &ForecastConfig, caps: Caps, sim: &SimInputs) -> Self {
        let past = caps.no_battery() || sim.day_start_soc_pct.is_some();
        // Unknown SOC starts at the reserve floor (full headroom): no curtailment that cannot be justified.
        let live = sim.start_soc_pct.or(config.battery.as_ref().map(|b| b.min_soc)).unwrap_or(0.0);
        let seed = if past { sim.day_start_soc_pct.unwrap_or(live) } else { live };
        Self {
            caps,
            load_w: sim.house_load_w.unwrap_or(0.0),
            soc_kwh: caps.battery_kwh * (seed / 100.0),
            past,
            reseed_pct: if past { sim.start_soc_pct } else { None },
        }
    }

    /// Usable watts of one slot, carrying the battery's energy to the next.
    fn step(&mut self, pv_w: f64, width_ms: i64) -> f64 {
        #[allow(clippy::cast_precision_loss, reason = "a slot width of at most an hour is exact in f64")]
        let hours = width_ms as f64 / HOUR_MS as f64;
        let flows = flow_step(pv_w, self.load_w, hours, &self.caps, self.soc_kwh);
        self.soc_kwh += ((flows.charge - flows.discharge) * hours) / 1000.0;
        pv_w.max(0.0) - flows.curtailed
    }
}

/// The usable series, or `None` when nothing can clip and the raw series stands.
pub(super) fn usable(
    config: &ForecastConfig,
    raw: &[Point],
    slots: &Slots,
    sim: &SimInputs,
) -> Option<Vec<Point>> {
    let caps = Caps::of(config);
    if !caps.clip() {
        return None;
    }
    let mut run = Sim::new(config, caps, sim);
    let mut reseeded = false;
    let mut out = Vec::with_capacity(raw.len());
    for (i, point) in raw.iter().enumerate() {
        let (start, width) = (slots.start_ms[i], slots.width_ms[i]);
        let past = start + width <= slots.now_ms;
        if past && !run.past {
            out.push(point.clone());
            continue;
        }
        if !past && !reseeded {
            reseeded = true;
            if let Some(pct) = run.reseed_pct {
                run.soc_kwh = run.caps.battery_kwh * (pct / 100.0);
            }
        }
        let watts = run.step(point.watts, width);
        // Clipping caps the instantaneous peak by the slot's usable share.
        let peak_watts = if point.watts > 0.0 { point.peak_watts * (watts / point.watts) } else { watts };
        out.push(Point { time: point.time.clone(), watts, peak_watts });
    }
    Some(out)
}
