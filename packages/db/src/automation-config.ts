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

const peakShavingConfigSchema = z.object({
  /** Run the peak-shaving loop. Requires the master `enabled` gate too. */
  enabled: z.boolean().default(false),
  /**
   * `maximize-exports`: battery only absorbs power above the export limit.
   * `grid-friendly`: battery absorbs everything above a dynamic threshold
   * chosen so today's remaining surplus roughly fills the battery — the
   * export curve flattens instead of spiking to the limit.
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
