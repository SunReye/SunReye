/**
 * Day-ahead price source config — which market, from which provider. Stored in
 * `app_settings` under {@link SPOT_PRICE_KEY} and validated with
 * {@link spotPriceConfigSchema}, mirroring the weather/evcc pattern.
 *
 * Deliberately separate from the tariff config: this is *plumbing* owned by the
 * fetch job, while the tariff owns the *economics* (what a kWh is worth). The
 * split matters because a plant may well want the negative-slot indicator and
 * the price-aware automation while keeping an ordinary fixed bill — and because
 * the automation can then depend on the price feed without pulling in the cost
 * model.
 *
 * Holds **no credentials**: the default provider is keyless. A provider that
 * needs a token (ENTSO-E) adds a masked field here rather than an env var, the
 * way the MQTT password does — it is a per-instance, user-obtained secret that
 * must be editable from the UI.
 */

import { z } from "zod";

/** `app_settings.key` under which the spot price config is stored. */
export const SPOT_PRICE_KEY = "spot-prices";

export const spotPriceConfigSchema = z.object({
  /** Fetch day-ahead prices and expose them to the UI/automations. */
  enabled: z.boolean().default(false),
  /** Price source; must match a provider registered in the server. */
  provider: z.string().min(1).default("energy-charts"),
  /**
   * Bidding zone (market area) the plant settles in, e.g. `DE-LU`. Validated
   * against the selected provider's advertised zones at write time, not here —
   * the registry lives in the server.
   */
  zone: z.string().min(1).max(24).default("DE-LU"),
});
export type SpotPriceConfig = z.infer<typeof spotPriceConfigSchema>;

export const defaultSpotPriceConfig: SpotPriceConfig = spotPriceConfigSchema.parse({});

/** Whether the price feed should run (enabled and a zone to ask for). */
export function spotPricesReady(cfg: SpotPriceConfig): boolean {
  return cfg.enabled && cfg.zone.trim().length > 0;
}
