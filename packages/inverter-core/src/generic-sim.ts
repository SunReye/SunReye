import type { CanonicalRole } from "./roles";
import type { InverterProfile, MetricDef, MetricValues, SimContext } from "./types";

/**
 * Generic, profile-agnostic coherent simulator.
 *
 * Rather than jittering each register independently, it simulates one physical
 * system (sun → PV → battery → grid → load) and maps the shared state onto the
 * profile's metrics **by canonical role**, so any profile — or a bare primitive
 * set — produces plausible, energy-balanced, time-aware samples with no
 * profile-specific `simulate` hook. Profiles that ship their own `simulate`
 * override this; everything else falls back here (see {@link SimulatedInverter}).
 *
 * Sign conventions (matching the role catalog):
 *   battery.power  > 0 charging, < 0 discharging
 *   grid.power     > 0 importing, < 0 exporting
 *
 * The model reads real elapsed wall-clock time (`dtSec`) so day/night and the
 * battery SoC drift look right on a long-running wall display.
 */

const PV_PLANT_PEAK_W = 8000; // total array peak across all strings
const BATTERY_CAPACITY_KWH = 10;
const BATTERY_NOMINAL_V = 51.2;
const MIN_SOC = 15;
const MAX_CHARGE_W = 3000;
const MAX_DISCHARGE_W = 3500;
const BASE_LOAD_W = 450;
const PV_STRING_V = 330;
const GRID_PHASE_V = 230;

/** Persisted plant state (typed view over the untyped `SimState` bag). */
interface PlantState {
  inited: number;
  dayKey: number;
  soc: number;
  productionDay: number;
  productionTotal: number;
  chargeDay: number;
  chargeTotal: number;
  dischargeDay: number;
  dischargeTotal: number;
  importDay: number;
  importTotal: number;
  exportDay: number;
  exportTotal: number;
  loadDay: number;
  loadTotal: number;
}

const round = (v: number, d = 0): number => {
  const f = 10 ** d;
  return Math.round(v * f) / f;
};
const jitter = (spread: number): number => 1 + (Math.random() - 0.5) * spread;

/** 0 at night, smooth bell peaking near solar noon (~13:00). */
function irradiance(now: Date): number {
  const h = now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;
  const day = (h - 6) / 14; // sunrise ~06:00, sunset ~20:00
  if (day <= 0 || day >= 1) return 0;
  return Math.sin(Math.PI * day) ** 1.3;
}

function initState(s: PlantState): void {
  if (s.inited === 1) return;
  s.inited = 1;
  s.soc = 58;
  // Lifetime counters (kWh) — arbitrary but plausible starting odometer.
  s.productionTotal = 12480;
  s.chargeTotal = 6320;
  s.dischargeTotal = 5910;
  s.importTotal = 4230;
  s.exportTotal = 8115;
  s.loadTotal = 10870;
  s.dayKey = -1;
}

function resetDaily(s: PlantState, now: Date): void {
  const dayKey = Math.floor((now.getTime() - now.getTimezoneOffset() * 60000) / 86400000);
  if (s.dayKey === dayKey) return;
  s.dayKey = dayKey;
  s.productionDay = 0;
  s.chargeDay = 0;
  s.dischargeDay = 0;
  s.importDay = 0;
  s.exportDay = 0;
  s.loadDay = 0;
}

/** Profile metrics carrying a role, ascending by 1-based index (0 when unset). */
function byRole(profile: InverterProfile, role: CanonicalRole): MetricDef[] {
  return profile.metrics
    .filter((m) => m.role === role)
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
}

/** Everything the per-subsystem stages of one tick share. */
interface PlantTick {
  profile: InverterProfile;
  /** The sample being built. */
  out: MetricValues;
  /**
   * Write one value to *every* metric carrying `role`, rounded to `d` decimals
   * (roles the profile doesn't map are silently skipped).
   */
  set: (role: CanonicalRole, value: number, d?: number) => void;
  /** Sun strength for this tick: 0 at night, ~1 at solar noon. */
  irr: number;
  /** Seconds since the previous sample. */
  dtSec: number;
  state: PlantState;
}

/**
 * PV production. With mapped strings the plant peak is split across them (each
 * also getting a voltage/current pair); with none, only the plant total is
 * synthesized. Returns the plant total in W.
 */
function simulatePv(t: PlantTick): number {
  const strings = byRole(t.profile, "pv.string.power");
  if (strings.length === 0) {
    const total = t.irr > 0 ? PV_PLANT_PEAK_W * t.irr * jitter(0.08) : 0;
    t.set("pv.total.power", total);
    return total;
  }

  const stringPeak = PV_PLANT_PEAK_W / strings.length;
  const voltages = byRole(t.profile, "pv.string.voltage");
  const currents = byRole(t.profile, "pv.string.current");
  let total = 0;
  strings.forEach((m, i) => {
    const p = t.irr > 0 ? stringPeak * t.irr * jitter(0.08) : 0;
    t.out[m.key] = round(p);
    total += p;
    const v = t.irr > 0.02 ? PV_STRING_V * jitter(0.05) : 0;
    if (voltages[i]) t.out[voltages[i]!.key] = round(v, 1);
    if (currents[i]) t.out[currents[i]!.key] = round(v > 0 ? p / v : 0, 2);
  });
  t.set("pv.total.power", total);
  return total;
}

/**
 * Battery dispatch that soaks up PV surplus and covers a deficit within the SoC
 * window, advancing the persisted SoC. Returns W: `> 0` charging, `< 0`
 * discharging, `0` when the profile maps no battery at all.
 */
function simulateBattery(t: PlantTick, pvTotal: number, load: number): number {
  const mapped =
    byRole(t.profile, "battery.soc").length + byRole(t.profile, "battery.power").length > 0;
  if (!mapped) return 0;

  const s = t.state;
  const surplus = pvTotal - load;
  let battPower = 0;
  if (surplus > 0 && s.soc < 100) battPower = Math.min(surplus, MAX_CHARGE_W);
  else if (surplus < 0 && s.soc > MIN_SOC) battPower = Math.max(surplus, -MAX_DISCHARGE_W);

  const battEnergyKwh = (battPower * t.dtSec) / 3_600_000;
  s.soc = Math.min(100, Math.max(MIN_SOC, s.soc + (battEnergyKwh / BATTERY_CAPACITY_KWH) * 100));
  const battV = BATTERY_NOMINAL_V + (s.soc - 50) * 0.03;
  t.set("battery.power", battPower);
  t.set("battery.soc", s.soc);
  t.set("battery.voltage", battV, 2);
  t.set("battery.current", battPower / battV, 2);
  t.set("battery.temperature", 22 + 8 * t.irr + 4 * (Math.abs(battPower) / MAX_DISCHARGE_W), 1);
  return battPower;
}

/** Grid + load, aggregate and per phase (an unmapped phase count reads as 1). */
function simulateAcSide(t: PlantTick, grid: number, load: number): void {
  t.set("grid.power", grid);
  const gridPhases = byRole(t.profile, "grid.phase.power");
  const nGrid = gridPhases.length || 1;
  gridPhases.forEach((m) => (t.out[m.key] = round(grid / nGrid)));
  t.set("grid.phase.voltage", GRID_PHASE_V * jitter(0.02), 1);
  for (const m of byRole(t.profile, "grid.phase.current")) {
    t.out[m.key] = round(grid / nGrid / GRID_PHASE_V, 2);
  }

  t.set("load.power", load);
  const loadPhases = byRole(t.profile, "load.phase.power");
  const nLoad = loadPhases.length || 1;
  loadPhases.forEach((m) => (t.out[m.key] = round(load / nLoad)));
}

/**
 * Integrate this tick's power (W over `dtSec`) into the day + lifetime kWh
 * counters and publish them. Each counter takes only the positive part of its
 * signal, so charge/discharge and import/export stay separate odometers.
 */
function integrateEnergy(
  t: PlantTick,
  pvTotal: number,
  battPower: number,
  grid: number,
  load: number,
): void {
  const s = t.state;
  const wh = (w: number) => (Math.max(w, 0) * t.dtSec) / 3_600_000;
  s.productionDay += wh(pvTotal);
  s.productionTotal += wh(pvTotal);
  s.chargeDay += wh(battPower);
  s.chargeTotal += wh(battPower);
  s.dischargeDay += wh(-battPower);
  s.dischargeTotal += wh(-battPower);
  s.importDay += wh(grid);
  s.importTotal += wh(grid);
  s.exportDay += wh(-grid);
  s.exportTotal += wh(-grid);
  s.loadDay += wh(load);
  s.loadTotal += wh(load);

  t.set("production.today", s.productionDay, 1);
  t.set("production.total", s.productionTotal, 1);
  t.set("battery.energy.charged.today", s.chargeDay, 1);
  t.set("battery.energy.charged.total", s.chargeTotal, 1);
  t.set("battery.energy.discharged.today", s.dischargeDay, 1);
  t.set("battery.energy.discharged.total", s.dischargeTotal, 1);
  t.set("grid.energy.imported.today", s.importDay, 1);
  t.set("grid.energy.imported.total", s.importTotal, 1);
  t.set("grid.energy.exported.today", s.exportDay, 1);
  t.set("grid.energy.exported.total", s.exportTotal, 1);
  t.set("load.energy.today", s.loadDay, 1);
  t.set("load.energy.total", s.loadTotal, 1);
}

export function genericSimulate(
  profile: InverterProfile,
  { now, dtSec, state }: SimContext,
): MetricValues {
  const s = state as unknown as PlantState;
  initState(s);
  resetDaily(s, now);

  const out: MetricValues = {};
  const t: PlantTick = {
    profile,
    out,
    set: (role, value, d = 0) => {
      for (const m of byRole(profile, role)) out[m.key] = round(value, d);
    },
    irr: irradiance(now),
    dtSec,
    state: s,
  };

  const pvTotal = simulatePv(t);
  // Load: base draw + daytime activity + occasional spikes.
  const spike = Math.random() < 0.05 ? 1500 * Math.random() : 0;
  const load = BASE_LOAD_W + 350 * t.irr + spike + BASE_LOAD_W * (jitter(0.2) - 1);
  const battPower = simulateBattery(t, pvTotal, load);
  // The grid balances whatever PV and the battery didn't: >0 import, <0 export.
  const grid = load + battPower - pvTotal;
  simulateAcSide(t, grid, load);

  t.set("inverter.temperature.dc", 30 + 20 * t.irr + 5 * (load / 5000), 1);
  t.set("inverter.temperature.ac", 26 + 20 * t.irr + 5 * (load / 5000), 1);

  integrateEnergy(t, pvTotal, battPower, grid, load);
  return out;
}
