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

import { haExportParamsSchema } from "./integrations";

/** `app_settings.key` under which the MQTT export config is stored. */
export const MQTT_KEY = "mqtt";

/**
 * THIS DOCUMENT IS BEING RETIRED. Its fields are
 * `./integrations.ts`'s `haExportParamsSchema`, spread in rather than restated
 * — so the two cannot drift while both exist, and the `ha-export` row migration
 * 0007 backfills is key-for-key what this parses.
 *
 * `connectionId` is the only field that does NOT move into `params`: it becomes
 * `integrations.connection_id`, a real column with a real foreign key, which is
 * the whole point of the table.
 */
export const mqttConfigSchema = z.object({
  /**
   * The `kind = 'mqtt'` connection this export publishes to, or null for "off".
   *
   * A soft reference, like `plants.tariff_key`: no foreign key, because the id
   * lives in a JSONB document and a deleted connection must leave the export
   * turned off rather than make the row undeletable. Every reader resolves it
   * and treats "no such connection" exactly as it treats null.
   *
   * `integrations.connection_id` (migration 0007) is the hard reference that
   * replaces this, and `ON DELETE RESTRICT` is what makes the dangling case —
   * and `apps/server/src/settings/mqtt-broker.ts`'s re-bind policy for it —
   * unrepresentable rather than merely handled.
   */
  connectionId: z.number().int().positive().nullable().default(null),
  ...haExportParamsSchema.shape,
});
export type MqttConfig = z.infer<typeof mqttConfigSchema>;

// fallow-ignore-next-line unused-export -- the record's own defaults, asserted directly in `../../../apps/server/src/settings/mqtt-config.test.ts`; the settings route still serves this record, and `integrations` (migration 0007) is what retires it.
export const defaultMqtt: MqttConfig = mqttConfigSchema.parse({});
