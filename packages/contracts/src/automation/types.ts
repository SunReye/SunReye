/**
 * Automation wire shapes shared by the server and the web app: the peak-shaving
 * engine's status, its decision log and forward projections, the run/price
 * enums, and the three HTTP/WebSocket payloads the automations feature reads.
 *
 * These are the definition site — the server's `automation/` modules import
 * them back, and the web automations feature imports them from
 * `@SunReye/contracts/automation` (mostly through the `$lib/automations`
 * barrel). Type-only — no runtime tail (see AGENTS.md).
 *
 * `AutomationConfig` and `PeakShavingMode` are re-exported from `@SunReye/db`:
 * their zod schemas stay in the db package (moving them would give contracts a
 * runtime tail and a `zod` dependency), so contracts takes a type-only dep on
 * db and re-exports the inferred shapes.
 */

export type { AutomationConfig, PeakShavingMode } from "@SunReye/db/automation-config";

import type { PeakShavingMode } from "@SunReye/db/automation-config";
import type { CanonicalRole } from "@SunReye/inverter-core";

/** Why the automation cannot run: an unmapped role or missing plant config. */
export type Blocker =
  | { kind: "role"; role: CanonicalRole }
  | { kind: "config"; what: "export-limit" | "battery" | "smart-meter" };

/**
 * What the plant is doing about prices right now.
 *
 * - `none` — off, or no usable price data.
 * - `waiting` — a window is known but nothing needs doing yet (the pack will
 *   arrive with enough room on its own).
 * - `pre-shape` — holding the charge ceiling down to make room for a window.
 * - `spend-down` — already too full to make room by withholding alone.
 * - `absorb` — inside a window: take everything the pack can.
 */
export type PriceRegime = "none" | "waiting" | "pre-shape" | "spend-down" | "absorb";

/**
 * There is no `DecisionPoint` any more (#172).
 *
 * What a tick decided is a READING now, stored in `metrics_raw` under the device
 * slug `optimizer` and read back over `/api/history` and `/api/history/rollup`
 * like any other device's series. The shape this replaced was a wire type for a
 * 2 880-slot in-memory ring: 24 hours of decisions, gone on restart, with no
 * rollups, no CSV export, no custom charts and no archive round trip.
 *
 * It also carried the plant's own measurements (`pvW`, `loadW`, `evChargeW`,
 * `batteryV`, `chargeW`, `exportW`, `socPct`) beside the decision, because it
 * was the only thing a chart could read. Those are `pv.total.power`,
 * `load.power`, `ev.charge.power`, `battery.voltage`, `battery.power`,
 * `grid.power` and `battery.soc`, on the devices that measure them.
 */

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

/** The two projections the UI offers, computed from one set of live inputs. */
export interface PeakShavingPlans {
  /** Rest of the current plant-local day, from now. */
  today: PeakShavingPlan;
  /** The whole next local day; empty slots when the forecast doesn't reach it. */
  tomorrow: PeakShavingPlan;
}

export type PeakShavingRunState =
  | "disabled"
  | "blocked"
  | "idle"
  /** Steering the register. */
  | "active"
  /** Deciding and logging, but writing nothing (`shadowMode`). */
  | "shadow"
  /** Switched off, but a runnable setup still decides in dry-run each tick. */
  | "simulating"
  | "stale";

export interface PeakShavingStatus {
  /** Effective: master gate AND the peak-shaving toggle. */
  enabled: boolean;
  mode: PeakShavingMode;
  state: PeakShavingRunState;
  blockers: Blocker[];
  /**
   * What stops *price awareness* specifically. Kept apart from `blockers`
   * because a missing smart-meter date says nothing about whether peak shaving
   * can run — only that §51 does not apply to this plant.
   */
  priceBlockers: Blocker[];
  lastTickAt: string | null;
  lastWriteAt: string | null;
  lastError: string | null;
  targetA: number | null;
  lastWrittenA: number | null;
  /** Current register value from the live sample. */
  liveA: number | null;
  thresholdW: number | null;
  /**
   * Feed-in ceiling last written to the solar-sell register, W — `grid-friendly`
   * only, since holding export below the plant limit is what that register does.
   */
  sellLimitW: number | null;
  /** Current solar-sell register value from the live sample, W. */
  liveSellLimitW: number | null;
  /** Grid-charge current we commanded for a window, A; null when not grid-charging. */
  gridChargeA: number | null;
  liveExcessW: number | null;
  /** House load the thresholds were measured against, W; null when unknown. */
  loadW: number | null;
  headroomKwh: number | null;
  /**
   * Usable battery energy from the forecast config, kWh — lets the client
   * re-derive headroom from the live 1 Hz SOC between ticks. Null until a tick
   * has read the config (or when no battery is configured).
   */
  usableKwh: number | null;
  remainingAboveLimitKwh: number | null;
  /** Live EV charge power the decision subtracted; null when EVCC is off. */
  evChargeW: number | null;
  /** Remaining EV charge demand deducted from the surplus; null when EVCC is off. */
  evDemandKwh: number | null;
  forecastAvailable: boolean;
  /** The register drifted from our last write (e.g. edited in Controls). */
  externalOverride: boolean;
  /**
   * The ceiling is being raised but the battery isn't absorbing — the inverter's
   * work mode is almost certainly overriding it, so the automation is a no-op.
   * Only ever set when the profile maps `battery.power`.
   */
  ineffective: boolean;
  /** A snapshot is held — the user's value will be restored on release. */
  restorePending: boolean;
  /** What price awareness is doing; `none` when off or without prices. */
  priceRegime: PriceRegime;
  /** SOC bound the pre-window envelope allows now, %; null when not shaping. */
  socEnvelopePct: number | null;
  /** Start/end of the negative-price window in play, epoch ms; null when none. */
  windowStartsAt: number | null;
  windowEndsAt: number | null;
  /** Energy that window can push into the pack, kWh. */
  soakableKwh: number | null;
  /** Window energy that will earn nothing whatever the pack does, kWh. */
  unavoidableZeroValueKwh: number | null;
}

export interface AutomationStatusView {
  peakShaving: PeakShavingStatus;
}

/** Payload of `GET /api/automations/plan`. */
export interface AutomationPlanView {
  peakShaving: PeakShavingPlans | null;
}

/**
 * One frame of the `automations` topic: pushed after every engine tick, and once
 * as the subscribe-time snapshot.
 *
 * ONE VARIANT, not two. The snapshot used to carry a whole decision ring in a
 * `history` field that every later frame omitted, so a client had to sniff which
 * kind of frame it was holding. What each tick decided is history in
 * `metrics_raw` now, so this topic carries only the two things a hypertable must
 * never hold: LIVE ENGINE STATE (error strings, blockers, a countdown) and a
 * FORECAST.
 */
export interface AutomationStreamMessage {
  /** Engine cadence, ms — the countdown base for "next decision in …". */
  tickMs: number;
  status: PeakShavingStatus;
  /** Today/tomorrow projections, recomputed per tick; null without a forecast. */
  plan: PeakShavingPlans | null;
}
