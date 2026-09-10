/**
 * THE HOME ASSISTANT EXPORT — what to publish and where to announce it, and
 * NOTHING about the broker.
 *
 * This record used to conflate two things: an outbound export (which entities to
 * publish, whether to announce HA discovery) and the BROKER ENDPOINT that the
 * EVCC ingest reused, with a comment on `evcc-config.ts` admitting it — "Broker
 * parameters are deliberately absent: they come from the MQTT config". Only the
 * endpoint is connection-shaped, so since #217 the endpoint half is a
 * `kind = 'mqtt'` row in `connections` (`./connection-kinds.ts`) and this record
 * keeps the export half plus the id of the connection it dials.
 *
 * WHAT WENT AWAY WITH IT, AND WHY THAT IS THE POINT
 *
 *  - `brokerUrl`, `username`, `password`. There is no secret left here at all,
 *    so there is nothing to mask on read and nothing to preserve on write —
 *    `maskConnectionParams` / `mergeConnectionParams` own that now, once, for
 *    every kind rather than for this one document.
 *  - `enabled`. A NULL {@link MqttConfig.connectionId} IS "off". Two fields
 *    could disagree about whether the bridge should be publishing (enabled with
 *    no broker; a broker with the flag off), and every consumer would have to
 *    decide which one wins.
 *
 * Stored in `app_settings` under {@link MQTT_KEY} — a FLAT record, deliberately
 * not a discriminated union: `readSetting` safe-parses to the default with no
 * log, so a union arm's drift would silently reset the whole document (the
 * settings-schema-silent-reset trap). The discriminated union is safe on
 * `connections` because those are rows that throw.
 *
 * Shared by the server (the runtime controller) and the web app (the
 * Integrations card).
 */

import { z } from "zod";

/** `app_settings.key` under which the MQTT export config is stored. */
export const MQTT_KEY = "mqtt";

export const mqttConfigSchema = z.object({
  /**
   * The `kind = 'mqtt'` connection this export publishes to, or null for "off".
   *
   * A soft reference, like `plants.tariff_key`: no foreign key, because the id
   * lives in a JSONB document and a deleted connection must leave the export
   * turned off rather than make the row undeletable. Every reader resolves it
   * and treats "no such connection" exactly as it treats null.
   */
  connectionId: z.number().int().positive().nullable().default(null),
  /** Root topic segment: `<prefix>/<plant-slug>/<device-slug>/<topic>`. */
  topicPrefix: z.string().min(1).default("sunreye"),
  /** Publish Home Assistant MQTT Discovery configs. */
  haDiscoveryEnabled: z.boolean().default(false),
  haDiscoveryPrefix: z.string().min(1).default("homeassistant"),
});
export type MqttConfig = z.infer<typeof mqttConfigSchema>;

export const defaultMqtt: MqttConfig = mqttConfigSchema.parse({});

/**
 * Whether the export has a broker to dial at all.
 *
 * Spelled once, here, rather than as `connectionId !== null` at each call site:
 * that is the comparison the retired `enabled` flag used to hide, and a reader
 * that got it backwards would publish nothing while reporting itself on.
 */
export function mqttExportConfigured(config: MqttConfig): boolean {
  return config.connectionId !== null;
}
