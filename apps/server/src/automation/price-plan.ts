/**
 * Negative-price windows, and what the battery should be doing about them.
 *
 * The pure half of price awareness — a function of its arguments, no DB, no
 * clock — so every regime and boundary is directly unit-testable, mirroring
 * `./peak-shaving`. The actuation itself stays in peak shaving, which owns the
 * registers; this module only says *what* the constraint should be.
 *
 * ## The problem it solves
 *
 * Under §51 EEG a plant commissioned after 2025-02-25 is paid nothing for energy
 * exported during a quarter-hour whose day-ahead price was negative. Exporting
 * then is worthless — but not costly — so there is nothing to gain by curtailing
 * PV. The only way to keep the value is to have somewhere to put the energy, and
 * for a battery that means **arriving at the window with room**.
 *
 * ## The honest part
 *
 * Withholding charge is often not enough on its own. Taking a 15 kWh pack from
 * 62 % to 10 % in the three hours before a window needs ~7.8 kWh of sink; a
 * 400 W house supplies 1.2 kWh of it. So the planner reports
 * {@link PriceAction.unavoidableZeroValueKwh} — the energy that will earn nothing
 * whatever it does — instead of quietly under-delivering and looking broken.
 * Shifting flexible load into the window is what actually closes that gap.
 */

import type { PriceRegime } from "@SunReye/contracts/automation";
import type { PriceAwareConfig } from "@SunReye/db/automation-config";
import { HOUR_MS } from "../energy/energy-flow";
import { type ForecastSlice, slotsBetween } from "./slot-window";
import type { SpotSlice } from "@SunReye/contracts/prices";

const MINUTE_MS = 60_000;

/** A contiguous run of sub-threshold slots — one thing to plan around. */
export interface PriceWindow {
  startMs: number;
  /** Exclusive end: the instant the last negative slot finishes. */
  endMs: number;
  /** Deepest price in the run, EUR/MWh. */
  minEurPerMwh: number;
  slots: number;
}

export interface PriceInputs {
  price: PriceAwareConfig;
  /** Market prices for today+tomorrow, or null when unavailable. */
  prices: SpotSlice | null;
  /** Raw PV forecast, or null when the provider is down. */
  forecast: ForecastSlice | null;
  nowMs: number;
  socPct: number;
  /** Reserve floor the pack is never taken below, %. */
  minSocPct: number;
  usableKwh: number;
  baselineLoadW: number;
  /** Charge power ceiling the pack can actually accept, W. */
  maxChargeW: number;
  /**
   * Whether the plant's import price tracks the market. Grid-charging is pointless
   * on a fixed tariff, so the planner refuses to ask for it — the caller decides,
   * because the tariff is not this module's business.
   */
  importFollowsMarket: boolean;
}

export interface PriceAction {
  regime: PriceRegime;
  /** The window being planned for or currently in, if any. */
  window: PriceWindow | null;
  /** Feed-in ceiling to apply this tick, W; null = leave the plant's own. */
  exportLimitW: number | null;
  /** Charge-power ceiling this tick, W; null = unconstrained. */
  chargeCeilingW: number | null;
  /**
   * Charge current to draw *from the grid* this tick, A; null = don't grid-charge.
   *
   * Only ever set inside a window, and only when the caller says the import price
   * follows the market — a negative *wholesale* price does not lower a fixed bill.
   */
  gridChargeA: number | null;
  /** The SOC bound the envelope allows right now, %; null when not shaping. */
  socEnvelopePct: number | null;
  /** Energy the window can push into the pack, kWh; null without a window. */
  soakableKwh: number | null;
  /**
   * Window energy that will earn nothing no matter what the pack does, kWh:
   * surplus beyond the charger's rate plus whatever exceeds the pack's capacity.
   * The number that keeps the feature honest rather than magical.
   */
  unavoidableZeroValueKwh: number | null;
}

const IDLE: PriceAction = {
  regime: "none",
  window: null,
  exportLimitW: null,
  chargeCeilingW: null,
  gridChargeA: null,
  socEnvelopePct: null,
  soakableKwh: null,
  unavoidableZeroValueKwh: null,
};

const clampSoc = (pct: number): number => Math.min(100, Math.max(0, pct));

/** Width of a price slot, ms — the grid the slice is stored on. */
const slotMs = (prices: SpotSlice): number => prices.stepMinutes * MINUTE_MS;

/**
 * Contiguous runs of sub-threshold slots.
 *
 * Adjacency is checked on the instant, not on array position, so a hole in the
 * stored series splits a window instead of joining two runs with unpriced time
 * between them. Up to `bridgeGapSlots` non-negative slots are bridged: emptying
 * the pack twice for two windows a quarter-hour apart is worse than treating
 * them as one.
 */
function negativeWindows(prices: SpotSlice, cfg: PriceAwareConfig): PriceWindow[] {
  const step = slotMs(prices);
  const threshold = cfg.negativeThresholdEurPerMwh;
  const minMs = cfg.minWindowMinutes * MINUTE_MS;
  const bridgeMs = cfg.bridgeGapSlots * step;
  const windows: PriceWindow[] = [];

  for (const point of prices.series) {
    if (point.eurPerMwh > threshold) continue;
    const open = windows.at(-1);
    // Bridge only across a real gap in *time*; `endMs` already accounts for the
    // slots consumed, so the comparison works with or without missing rows.
    if (open && point.startMs - open.endMs <= bridgeMs) {
      open.endMs = point.startMs + step;
      open.minEurPerMwh = Math.min(open.minEurPerMwh, point.eurPerMwh);
      open.slots += 1;
      continue;
    }
    windows.push({
      startMs: point.startMs,
      endMs: point.startMs + step,
      minEurPerMwh: point.eurPerMwh,
      slots: 1,
    });
  }
  return windows.filter((w) => w.endMs - w.startMs >= minMs);
}

/** The window containing `atMs`, if any. */
const windowAt = (windows: PriceWindow[], atMs: number): PriceWindow | null =>
  windows.find((w) => atMs >= w.startMs && atMs < w.endMs) ?? null;

/** The first window starting within the lookahead, if any. */
const nextWindow = (
  windows: PriceWindow[],
  fromMs: number,
  horizonMs: number,
): PriceWindow | null =>
  windows.find((w) => w.startMs > fromMs && w.startMs <= fromMs + horizonMs) ?? null;

/** Surplus the pack could take, and surplus it provably cannot, over a window. */
function soakOf(
  forecast: ForecastSlice,
  window: PriceWindow,
  loadW: number,
  maxChargeW: number,
): { soakableKwh: number; spillKwh: number } {
  let soakableKwh = 0;
  let spillKwh = 0;
  for (const slot of slotsBetween(forecast, window.startMs, window.endMs)) {
    const hours = slot.remainingMs / HOUR_MS;
    const surplusW = Math.max(0, slot.watts - loadW);
    soakableKwh += (Math.min(surplusW, maxChargeW) * hours) / 1000;
    // Beyond the charger's own rate: worthless however empty the pack is, so it
    // must never be allowed to drive the envelope lower.
    spillKwh += (Math.max(0, surplusW - maxChargeW) * hours) / 1000;
  }
  return { soakableKwh, spillKwh };
}

/** Energy the house takes out of the pack between two instants, kWh. */
function drainKwhBetween(
  forecast: ForecastSlice,
  fromMs: number,
  toMs: number,
  loadW: number,
): number {
  let kwh = 0;
  for (const slot of slotsBetween(forecast, fromMs, toMs)) {
    kwh += (Math.max(0, loadW - slot.watts) * (slot.remainingMs / HOUR_MS)) / 1000;
  }
  return kwh;
}

/**
 * The SOC bound to hold at the end of the current slot.
 *
 * Walked backwards from the window: the pack may be `socTarget` at the start of
 * the window, plus whatever the house will drain out of it before then. Charging
 * is the controlled variable, so it never loosens the bound — only drain does.
 *
 * Holding a flat 0 A from now until the window would be wrong twice over: it
 * throws away pre-window PV that *is* paid for, and it can push the pack below
 * its reserve. This is the version that charges as much as possible, as late as
 * possible.
 */
function envelopePct(
  forecast: ForecastSlice,
  nowMs: number,
  windowStartMs: number,
  socTarget: number,
  usableKwh: number,
  loadW: number,
): { boundPct: number; currentSlotHours: number } {
  const runUp = slotsBetween(forecast, nowMs, windowStartMs);
  const first = runUp[0];
  if (!first) return { boundPct: socTarget, currentSlotHours: 0 };
  // Everything after the current slot loosens the bound that applies at the end
  // of the current slot.
  const laterDrainKwh = drainKwhBetween(
    forecast,
    first.startMs + first.remainingMs,
    windowStartMs,
    loadW,
  );
  return {
    boundPct: Math.min(100, socTarget + (100 * laterDrainKwh) / usableKwh),
    currentSlotHours: first.remainingMs / HOUR_MS,
  };
}

/** SOC the pack would reach by the window if nothing intervened. */
function unshapedSocPct(forecast: ForecastSlice, i: PriceInputs, windowStartMs: number): number {
  let gainKwh = 0;
  for (const slot of slotsBetween(forecast, i.nowMs, windowStartMs)) {
    const hours = slot.remainingMs / HOUR_MS;
    gainKwh += (Math.min(Math.max(0, slot.watts - i.baselineLoadW), i.maxChargeW) * hours) / 1000;
  }
  const drainKwh = drainKwhBetween(forecast, i.nowMs, windowStartMs, i.baselineLoadW);
  return clampSoc(i.socPct + (100 * (gainKwh - drainKwh)) / i.usableKwh);
}

/** Absorb mode: take everything, and say what still cannot be rescued. */
function absorbAction(
  i: PriceInputs,
  forecast: ForecastSlice | null,
  window: PriceWindow,
): PriceAction {
  const soak = forecast ? soakOf(forecast, window, i.baselineLoadW, i.maxChargeW) : null;
  const headroomKwh = (i.usableKwh * (100 - clampSoc(i.socPct))) / 100;
  const overflowKwh = soak ? Math.max(0, soak.soakableKwh - headroomKwh) : 0;
  // Buying from the grid only makes sense when the bill follows the market, and
  // only while there is room to put it.
  const gridCharge =
    i.price.gridChargeInWindow && i.importFollowsMarket && headroomKwh > 0
      ? i.price.gridChargeMaxA
      : null;
  return {
    ...IDLE,
    regime: "absorb",
    window,
    exportLimitW: i.price.soakFloorW,
    gridChargeA: gridCharge,
    soakableKwh: soak?.soakableKwh ?? null,
    unavoidableZeroValueKwh: soak ? soak.spillKwh + overflowKwh : null,
  };
}

/** Make room for a window that has not started yet. */
function shapeAction(i: PriceInputs, forecast: ForecastSlice, window: PriceWindow): PriceAction {
  const { soakableKwh, spillKwh } = soakOf(forecast, window, i.baselineLoadW, i.maxChargeW);
  const neededKwh = Math.min(soakableKwh, i.usableKwh);
  const socTarget = Math.min(
    100,
    Math.max(i.minSocPct, 100 - (100 * neededKwh) / i.usableKwh - i.price.reserveMarginPct),
  );
  // Anything the pack cannot hold even when emptied to its floor is unavoidable,
  // and so is anything past the charger's rate.
  const capacityKwh = (i.usableKwh * (100 - socTarget)) / 100;
  const unavoidableZeroValueKwh = spillKwh + Math.max(0, soakableKwh - capacityKwh);

  const unshaped = unshapedSocPct(forecast, i, window.startMs);
  const base = { ...IDLE, window, soakableKwh, unavoidableZeroValueKwh };
  // Nothing to do: the pack arrives with room on its own. Staying silent here
  // matters — otherwise an overcast morning would hold the ceiling down for
  // nothing and peak shaving would look broken.
  if (unshaped <= socTarget) return { ...base, regime: "waiting" };

  const { boundPct, currentSlotHours } = envelopePct(
    forecast,
    i.nowMs,
    window.startMs,
    socTarget,
    i.usableKwh,
    i.baselineLoadW,
  );
  const risePct = boundPct - clampSoc(i.socPct);
  // Already above the bound: withholding charge cannot get there, and the pack
  // needs a sink. Reported rather than silently under-delivered.
  if (risePct <= 0) {
    return { ...base, regime: "spend-down", chargeCeilingW: 0, socEnvelopePct: boundPct };
  }
  const chargeCeilingW =
    currentSlotHours > 0 ? ((risePct / 100) * i.usableKwh * 1000) / currentSlotHours : 0;
  return {
    ...base,
    regime: "pre-shape",
    chargeCeilingW: Math.max(0, chargeCeilingW),
    socEnvelopePct: boundPct,
  };
}

/**
 * Whether `nowMs` falls inside a negative-price window.
 *
 * Exists for the night gate: peak shaving parks the loop when there is no PV and
 * none imminent, which used to be a safe proxy for "nothing to do". Negative
 * prices are usually *wind*, and the deepest ones land at night — so the one
 * situation grid-charging exists for is exactly the one that gate would sleep
 * through.
 */
export function insideNegativeWindow(
  prices: SpotSlice | null,
  cfg: PriceAwareConfig,
  nowMs: number,
): boolean {
  if (!cfg.enabled || !prices) return false;
  return windowAt(negativeWindows(prices, cfg), nowMs) !== null;
}

/**
 * What price awareness wants from this tick.
 *
 * Degrades to {@link IDLE} — i.e. peak shaving untouched — whenever it is off,
 * the plant has no usable capacity, or there are no prices. An absent price is
 * *unknown*, never zero, so no data can never be mistaken for a negative slot.
 */
export function planPriceAction(i: PriceInputs): PriceAction {
  if (!i.price.enabled || !i.prices || i.usableKwh <= 0) return IDLE;

  const windows = negativeWindows(i.prices, i.price);
  const current = windowAt(windows, i.nowMs);
  if (current) return absorbAction(i, i.forecast, current);

  // Shaping needs a forecast: without one there is no way to know how much
  // surplus the window will bring, and guessing would hold the pack down blind.
  const upcoming = nextWindow(windows, i.nowMs, i.price.lookaheadHours * HOUR_MS);
  if (!upcoming || !i.forecast || !i.price.shapeSoc) {
    return upcoming ? { ...IDLE, regime: "waiting", window: upcoming } : IDLE;
  }
  return shapeAction(i, i.forecast, upcoming);
}
