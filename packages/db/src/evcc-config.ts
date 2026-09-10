/**
 * EVCC integration config — surfaces an external EVCC instance (EV charger)
 * in the dashboard. Stored in `app_settings` under {@link EVCC_KEY} and
 * validated with {@link evccConfigSchema}, mirroring the weather/mqtt pattern.
 *
 * Holds no broker CREDENTIALS — it names a `kind = 'mqtt'` CONNECTION instead
 * (#217). Until then this file said the broker "comes from the MQTT config",
 * which meant the EVCC ingest and the Home Assistant export could never be on
 * two different brokers, and every loadpoint device sat at
 * `connection_id = null`. Its own `connectionId` makes a second EVCC on a second
 * broker two rows rather than a schema change, and it is what the loadpoints are
 * bound to.
 */

import { z } from "zod";

/** `app_settings.key` under which the EVCC config is stored. */
export const EVCC_KEY = "evcc";

export const evccConfigSchema = z.object({
  /** Subscribe to the EVCC topics and show the EV card/node when true. */
  enabled: z.boolean().default(false),
  /**
   * The `kind = 'mqtt'` connection EVCC is published on, or null for "not
   * configured yet".
   *
   * A soft reference, exactly like `mqtt.connectionId`: the id lives in a JSONB
   * document with no foreign key, so a deleted connection leaves the ingest off
   * rather than making the row undeletable. `../../apps/server/src/settings/
   * mqtt-broker.ts`'s `brokerFrom` is the resolution, and every way of not
   * resolving means "no broker".
   */
  connectionId: z.number().int().positive().nullable().default(null),
  /** EVCC's MQTT root topic (its `mqtt.topic` setting; default `evcc`). */
  topicRoot: z.string().min(1).max(120).default("evcc"),
  /**
   * Split the EV out of the house-load figure in the power-flow diagram: the
   * load node becomes "Home" = `load − ev` and the EV gets its own node. Only
   * correct when the charger is metered inside the inverter's `load.power`
   * (wired on its load output). Off by default — the safe, wiring-agnostic view
   * shows the EV as an informational sub-branch of the full load.
   */
  subtractFromHome: z.boolean().default(false),
});
export type EvccConfig = z.infer<typeof evccConfigSchema>;

export const defaultEvcc: EvccConfig = evccConfigSchema.parse({});

/**
 * Whether the EVCC subscriber can run: enabled, and its connection resolved to a
 * broker.
 *
 * `broker` is what {@link EvccConfig.connectionId} resolved to, or null — the
 * caller does the resolving, so this stays a pure statement about the config.
 * The connection is EVCC's OWN: sharing the export's used to mean the ingest
 * silently followed a change to the Home Assistant broker, and that two EVCC
 * instances on two brokers were inexpressible.
 */
export function evccReady(cfg: EvccConfig, broker: { brokerUrl: string } | null): boolean {
  return cfg.enabled && broker !== null && broker.brokerUrl.trim().length > 0;
}
