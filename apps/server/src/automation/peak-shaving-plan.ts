/**
 * Peak shaving — the forward half: what the automation *will* do for the rest of
 * today, given the forecast it already trusts.
 *
 * The projection replays {@link decideTargetA} — the very same pure decision the
 * live tick makes — over each remaining forecast slot, carrying SOC forward as
 * it goes. So "charging starts at 11:15, full by 15:40" comes out of the rules
 * themselves; there is no second model of the automation to drift out of sync
 * with the first.
 *
 * One thing it models that is *not* a decision of the automation: discharge.
 * When PV falls short of the baseline load, the pack is assumed to serve the
 * house down to its configured reserve floor — the inverter's work mode does
 * this on its own, and without it the SOC track would sit flat all night while
 * the real battery drains.
 *
 * What it deliberately does not model:
 * - **Slew.** Each slot is decided from scratch (`previousThresholdW: null`);
 *   damping is a live-noise guard, not a property of the plan.
 * - **EV charging in time.** A connected car's remaining demand still shapes the
 *   plateau (it rides in {@link DecisionInputs.evRemainingKwh}), but the plan
 *   does not guess *when* the car draws, so the projected export is what is left
 *   after the battery — the car will take some of it.
 *
 * Each projection covers one plant-local day (the threshold search's scope);
 * {@link projectPeakShavingDays} chains two of them for the today/tomorrow view.
 */

import { HOUR_MS, type SlotFlows, flowStep } from "../energy/energy-flow";
import { type DecisionInputs, NEAR_FULL_KWH, decideTargetA } from "./peak-shaving";
import { type ForecastSlice, type ForecastSlot, remainingSlotsToday } from "./slot-window";

const DAY_MS = 86_400_000;

/** Absorption below this doesn't count as "charging starts here", W. */
const CHARGING_FLOOR_W = 50;

/** One projected forecast slot. */
export interface PlanSlot {
  /** Slot start, epoch ms. */
  t: number;
  /** Forecast (raw) PV for the slot, W. */
  pvW: number;
  /** House load assumed for the slot, W. */
  loadW: number;
  /** The shave threshold the automation would hold, W. */
  thresholdW: number;
  /** Charge-current ceiling it would write, A. */
  targetA: number;
  /** Battery absorption that ceiling actually admits, W. */
  chargeW: number;
  /** Battery power serving the house where PV falls short of the load, W. */
  dischargeW: number;
  /** What reaches the grid after load and battery, capped at the plant limit, W. */
  exportW: number;
  /** PV with nowhere left to go — above the cap with no room to store it, W. */
  curtailedW: number;
  /** Projected SOC at the *end* of the slot, %. */
  socPct: number;
}

export interface PeakShavingPlan {
  slots: PlanSlot[];
  /** Start of the first slot the plan charges in, ms; null when it never does. */
  chargeStartsAt: number | null;
  /** When the projection first runs out of headroom, ms; null when it doesn't today. */
  fullAt: number | null;
  /** SOC the plan ends the local day at, %. */
  endSocPct: number;
  storedKwh: number;
  exportedKwh: number;
  /** Energy the plan expects to lose because nothing can take it, kWh. */
  curtailedKwh: number;
}

/** The plant's real feed-in ceiling — unlike the decision's, with no safety buffer. */
export interface PlanLimits {
  exportCapW: number;
  /**
   * Reserve floor the modelled discharge never goes below, % SOC (the battery
   * config's `minSoc`). 0 (the default) lets the pack drain fully.
   */
  reserveSocPct?: number;
}

/** The two projections the UI offers, computed from one set of live inputs. */
export interface PeakShavingPlans {
  /** Rest of the current plant-local day, from now. */
  today: PeakShavingPlan;
  /** The whole next local day; empty slots when the forecast doesn't reach it. */
  tomorrow: PeakShavingPlan;
}

/** Plant-local midnight after `nowMs` — the instant tomorrow starts. */
function startOfNextLocalDay(nowMs: number, utcOffsetSeconds: number): number {
  const offsetMs = utcOffsetSeconds * 1000;
  return (Math.floor((nowMs + offsetMs) / DAY_MS) + 1) * DAY_MS - offsetMs;
}

/**
 * Project today and tomorrow in one go. Tomorrow is seeded with today's
 * projected end SOC (which already includes the evening's modelled discharge;
 * tomorrow's own dark early slots continue the drain to dawn) and drops the EV
 * picture: a connected car's remaining demand is a today figure that must not
 * shape the next day.
 */
export function projectPeakShavingDays(
  base: DecisionInputs & { forecast: ForecastSlice },
  limits: PlanLimits,
): PeakShavingPlans {
  const today = projectPeakShaving(base, limits);
  const tomorrow = projectPeakShaving(
    {
      ...base,
      socPct: today.endSocPct,
      evChargeW: 0,
      evRemainingKwh: 0,
      nowMs: startOfNextLocalDay(base.nowMs, base.forecast.utcOffsetSeconds),
    },
    limits,
  );
  return { today, tomorrow };
}

const clampSoc = (pct: number) => Math.min(100, Math.max(0, pct));

/** One future slot: replay the live decision at this SOC, run the physics under
 * its decided ceilings. `grid-friendly` steers the solar-sell register, so
 * feed-in cannot rise above the level it decided; `maximize-exports` leaves only
 * the plant's own cap in place. The discharge half is the inverter's own
 * behavior, not the automation's, but without it the SOC track would sit flat
 * all night. */
function projectSlot(
  base: DecisionInputs & { forecast: ForecastSlice },
  limits: PlanLimits,
  slot: ForecastSlot,
  socPct: number,
  reservePct: number,
): { flows: SlotFlows; thresholdW: number; targetA: number } {
  const decision = decideTargetA({
    ...base,
    pvW: slot.watts,
    socPct,
    liveLoadW: base.baselineLoadW,
    // No live draw to subtract in the future, and nothing measured to contain it.
    evChargeW: 0,
    evIncludedInLoad: false,
    previousThresholdW: null,
    previousTargetA: null,
    sinceLastDecisionMs: 0,
    nowMs: slot.startMs,
  });
  const sellCeilingW =
    base.mode === "grid-friendly" ? decision.thresholdW : Number.POSITIVE_INFINITY;
  const flows = flowStep(slot.watts, base.baselineLoadW, slot.remainingMs / HOUR_MS, {
    chargeCeilingW: decision.targetA * base.batteryV,
    headroomKwh: (base.usableKwh * (100 - socPct)) / 100,
    aboveFloorKwh: (base.usableKwh * (socPct - reservePct)) / 100,
    exportCeilingW: Math.min(sellCeilingW, limits.exportCapW),
  });
  return { flows, thresholdW: decision.thresholdW, targetA: decision.targetA };
}

/** SOC after one slot's charge/discharge balance, clamped to the pack. */
function advanceSoc(socPct: number, flows: SlotFlows, hours: number, usableKwh: number): number {
  if (usableKwh <= 0) return socPct;
  return clampSoc(socPct + (((flows.chargeW - flows.dischargeW) * hours) / 1000 / usableKwh) * 100);
}

/**
 * Project the rest of the local day. `base` is the same input the live tick
 * builds; the projection overrides the per-slot readings (`pvW`, `socPct`,
 * `nowMs`) and swaps live load for the baseline, since that is all a future slot
 * can know.
 */
// fallow-ignore-next-line unused-export -- exercised directly by peak-shaving.test.ts; test files aren't traced as consumers
export function projectPeakShaving(
  base: DecisionInputs & { forecast: ForecastSlice },
  limits: PlanLimits,
): PeakShavingPlan {
  const slots: PlanSlot[] = [];
  let socPct = clampSoc(base.socPct);
  let chargeStartsAt: number | null = null;
  let fullAt: number | null = null;
  let storedKwh = 0;
  let exportedKwh = 0;
  let curtailedKwh = 0;

  const reservePct = Math.min(100, Math.max(0, limits.reserveSocPct ?? 0));
  for (const slot of remainingSlotsToday(base.forecast, base.nowMs)) {
    const hours = slot.remainingMs / HOUR_MS;
    const { flows, thresholdW, targetA } = projectSlot(base, limits, slot, socPct, reservePct);

    storedKwh += (flows.chargeW * hours) / 1000;
    exportedKwh += (flows.exportW * hours) / 1000;
    curtailedKwh += (flows.curtailedW * hours) / 1000;
    socPct = advanceSoc(socPct, flows, hours, base.usableKwh);

    if (chargeStartsAt === null && flows.chargeW >= CHARGING_FLOOR_W) {
      // The running slot started before `now`; reporting its raw start would
      // claim charging begins in the past instead of "already charging".
      chargeStartsAt = Math.max(slot.startMs, base.nowMs);
    }
    if (fullAt === null && (base.usableKwh * (100 - socPct)) / 100 <= NEAR_FULL_KWH) {
      fullAt = slot.startMs + slot.remainingMs;
    }
    slots.push({
      t: slot.startMs,
      pvW: slot.watts,
      loadW: base.baselineLoadW,
      thresholdW,
      targetA,
      ...flows,
      socPct,
    });
  }

  return { slots, chargeStartsAt, fullAt, endSocPct: socPct, storedKwh, exportedKwh, curtailedKwh };
}
