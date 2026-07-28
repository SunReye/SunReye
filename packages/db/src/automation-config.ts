/**
 * Automations config — light, opt-in control loops that write inverter
 * registers on the user's behalf. Stored in `app_settings` under
 * {@link AUTOMATION_KEY} and validated with {@link automationConfigSchema},
 * mirroring the weather/evcc pattern.
 *
 * Deliberately holds **no plant parameters**: the export limit
 * (`maxOutputW`) and battery capacity come from the solar-forecast config
 * (weather.ts), the single source of truth the clipping model already uses.
 * Only automation-specific knobs live here.
 */

import { z } from "zod";

/** `app_settings.key` under which the automations config is stored. */
export const AUTOMATION_KEY = "automations";

const peakShavingModeSchema = z.enum(["maximize-exports", "grid-friendly"]);
export type PeakShavingMode = z.infer<typeof peakShavingModeSchema>;

/**
 * Tuning for the `grid-friendly` plateau. Ignored entirely in
 * `maximize-exports`, where the threshold is always the export limit.
 */
const gridFriendlyConfigSchema = z.object({
  /**
   * Feed-in floor for the plateau, W: the search never drops the threshold
   * below this, so some export keeps flowing instead of the battery absorbing
   * everything. 0 allows full absorption; a value at or above the export limit
   * degenerates to a classic shave at the limit.
   */
  minThresholdW: z.number().min(0).max(100_000).default(0),
  /**
   * How much of the remaining-day forecast surplus is believed, %. Below 100
   * assumes less surplus will arrive than forecast, so the plateau drops and
   * the battery charges earlier (hedging an overestimate); above 100 waits
   * longer. 100 takes the forecast at face value.
   */
  forecastTrustPct: z.number().min(10).max(200).default(100),
  /**
   * Maximum plateau movement per minute, W. Damps the threshold against a
   * jumpy forecast so the export level doesn't step around mid-day. 0 is
   * undamped.
   */
  slewWPerMin: z.number().min(0).max(100_000).default(600),
  /**
   * Maximum charge-current movement per minute, A. A step from idle to the full
   * ceiling is a multi-kW jump at the grid connection — the opposite of what
   * this mode is for — so the current ramps instead. 0 is undamped.
   */
  chargeSlewAPerMin: z.number().min(0).max(1_000).default(10),
  /**
   * Count connected cars' remaining charge demand against the day's surplus.
   * On, the battery assumes the car will eat that energy and charges earlier to
   * still fill up; off leaves the surplus to the car and keeps the plateau
   * higher.
   */
  reserveForEvDemand: z.boolean().default(true),
});
export type GridFriendlyConfig = z.infer<typeof gridFriendlyConfigSchema>;

const peakShavingConfigSchema = z.object({
  /** Run the peak-shaving loop. Requires the master `enabled` gate too. */
  enabled: z.boolean().default(false),
  /**
   * Dry run: decide every tick and record the decision for the charts, but
   * never write the register (and hand back any register already held). Lets a
   * plant watch what the automation *would* do before trusting it.
   */
  shadowMode: z.boolean().default(false),
  /**
   * `maximize-exports`: battery only absorbs power above the export limit.
   * `grid-friendly`: hold feed-in at a dynamic level below the limit and charge
   * the battery with the difference, so the midday export curve is flattened
   * *downward* instead of pinned at the limit. Needs the solar-sell max-power
   * register: charging alone cannot hold export below the plant's own limit.
   */
  mode: peakShavingModeSchema.default("maximize-exports"),
  /** Margin subtracted from the export limit before shaving kicks in, W. */
  safetyBufferW: z.number().min(0).max(100_000).default(500),
  /** Hard ceiling ever written to the charge-current register, A. */
  maxChargeA: z.number().positive().max(1_000).default(100),
  /** Charge current when no peak headroom must be reserved, A. */
  fallbackChargeA: z.number().min(0).max(1_000).default(50),
  /**
   * Floor kept on the charge-current ceiling when the battery is near full, A.
   * A hard 0 A would kick the pack out of absorption and starve the BMS's
   * top-balancing dwell time; a small allowance lets it finish. 0 disables.
   */
  topBalanceFloorA: z.number().min(0).max(100).default(5),
  /** Battery voltage for W→A when no `battery.voltage` metric is mapped, V. */
  nominalBatteryV: z.number().positive().max(1_500).default(51.2),
  /**
   * Seconds between control decisions — the engine tick cadence, i.e. how often
   * a register write may happen at most. The floor keeps the loop from racing
   * the poll cycle and grinding the inverter's EEPROM.
   */
  controlIntervalS: z.number().min(5).max(600).default(30),
  gridFriendly: gridFriendlyConfigSchema.default(gridFriendlyConfigSchema.parse({})),
});

export const automationConfigSchema = z.object({
  /**
   * Master gate, set from Settings. Enabling requires the user to have
   * accepted the register-write disclaimer (`disclaimerAcceptedAt`).
   */
  enabled: z.boolean().default(false),
  /** ISO timestamp of disclaimer acceptance; null until accepted. */
  disclaimerAcceptedAt: z.string().nullable().default(null),
  peakShaving: peakShavingConfigSchema.default(peakShavingConfigSchema.parse({})),
});
export type AutomationConfig = z.infer<typeof automationConfigSchema>;

export const defaultAutomations: AutomationConfig = automationConfigSchema.parse({});
