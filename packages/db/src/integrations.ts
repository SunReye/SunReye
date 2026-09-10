/**
 * WHAT AN INTEGRATION IS, PER KIND — the one discriminated union behind
 * `integrations.kind` + `integrations.params`.
 *
 * An INTEGRATION is a coded thing attached to a connection: the EVCC ingest
 * (subscribes on an MQTT connection, yields loadpoint devices) and the Home
 * Assistant export (publishes on an MQTT connection, yields nothing). A
 * connection-LESS kind — a weather provider, which dials a vendor URL that is
 * not an endpoint anyone configures — is why {@link integrations.connectionId}
 * is nullable rather than required.
 *
 * WHY THIS IS A TABLE AND NOT TWO `app_settings` DOCUMENTS
 *
 * Both of these lived in `app_settings.mqtt` and `app_settings.evcc`, and that
 * inherited two defects the row shape removes:
 *
 *  - THE SILENT RESET. `readSetting` safe-parses to the DEFAULT with no log, so
 *    one drifted field resets the whole document — an operator's topic prefix,
 *    their discovery choice, their broker binding, gone with nothing in the log
 *    (the settings-schema-silent-reset note). {@link parseIntegrationParams}
 *    THROWS instead, exactly as `./connection-kinds.ts`'s does, because these
 *    are ROWS and a row that will not parse is a loud row.
 *  - THE SOFT REFERENCE. `mqtt.connectionId` and `evcc.connectionId` are ids
 *    inside a JSONB document with no foreign key, so an operator can delete the
 *    connection they name and leave the id dangling —
 *    `apps/server/src/settings/mqtt-broker.ts` carries a whole
 *    re-bind-on-dangling policy for that case, and every consumer has to agree
 *    that "no such connection" means "off". `integrations.connection_id` is a
 *    real reference with `ON DELETE RESTRICT`: an integration row PINS its
 *    connection, so the dangling state is not a policy, it is unrepresentable.
 *
 * WHAT "CONFIGURED" MEANS
 *
 * A ROW'S PRESENCE. `enabled = false` is the off switch for a configured
 * integration; "not configured" is the ABSENCE of a row. There is no null
 * sentinel and no third state — which is what `mqtt.connectionId = null`
 * (meaning both "off" and "never set up") had become.
 *
 * WHY `kind` IS TEXT + CHECK AND NOT A POSTGRES ENUM
 *
 * The repo's documented doctrine — see `./connection-kinds.ts` and
 * `./schema/plants.ts`. Adding `weather` later is a CHECK rewrite inside the
 * migration's transaction and rolls back like any other statement;
 * `ALTER TYPE … ADD VALUE` cannot be rolled back and, on older servers, cannot
 * run in a transaction block at all.
 *
 * EACH ARM IS A FLAT RECORD. The `z.discriminatedUnion` appears exactly once, at
 * the parse boundary below, and nowhere in a stored document — see the silent
 * reset above.
 */

import { z } from "zod";

/**
 * Every integration kind this build can run.
 *
 * The CHECK constraint on `integrations.kind` is rendered from this list
 * (`./schema/plants.ts`). A third value arrives as: an entry here, an arm below,
 * a runtime that reads it, and a CHECK rewrite migration. No column changes.
 */
export const INTEGRATION_KINDS = ["evcc-ingest", "ha-export"] as const;
export type IntegrationKind = (typeof INTEGRATION_KINDS)[number];

/**
 * The EVCC ingest's own settings — everything that is not the broker.
 *
 * The broker is {@link integrations.connectionId}, and the loadpoints this
 * yields are `devices` rows, so what is left is one field. It is here rather
 * than only on the loadpoint devices because it is what the SUBSCRIPTION is
 * built from: the ingest has to subscribe before it knows which loadpoints
 * exist.
 *
 * `subtractFromHome` is deliberately NOT here. It is a rule about how the
 * house-load figure is composed (is the charger metered inside `load.power`?),
 * so it stays a plant-level setting — two ingests must not be able to disagree
 * about one plant's load model. Migration 0006 already made that call.
 */
// fallow-ignore-next-line unused-export -- one arm of `integrationParamsSchema`, asserted directly in `./integrations.test.ts`; test files are not traced as consumers.
export const evccIngestParamsSchema = z.object({
  /** EVCC's MQTT root topic (its `mqtt.topic` setting; default `evcc`). */
  topicRoot: z.string().min(1).max(120).default("evcc"),
});
// fallow-ignore-next-line unused-type -- the parsed arm the EVCC ingest reads; it moves onto this table in a later step.
export type EvccIngestParams = z.infer<typeof evccIngestParamsSchema>;

/**
 * The Home Assistant export's settings — what to publish and where to announce
 * it, and NOTHING about the broker.
 *
 * Field for field what `./mqtt-config.ts` holds today, minus its
 * `connectionId` (a column now) — so the backfill in migration 0007 is a
 * key-for-key copy and this file is what the readers move onto.
 */
export const haExportParamsSchema = z.object({
  /** Root topic segment: `<prefix>/<plant-slug>/<device-slug>/<topic>`. */
  topicPrefix: z.string().min(1).default("sunreye"),
  /** Publish Home Assistant MQTT Discovery configs. */
  haDiscoveryEnabled: z.boolean().default(false),
  haDiscoveryPrefix: z.string().min(1).default("homeassistant"),
});
// fallow-ignore-next-line unused-type -- the parsed arm the Home Assistant export reads; it moves onto this table in a later step.
export type HaExportParams = z.infer<typeof haExportParamsSchema>;

/**
 * THE union. One `z.discriminatedUnion` on `kind`, and the only place the two
 * param shapes are related to each other.
 */
// fallow-ignore-next-line unused-export -- THE union, asserted directly in `./integrations.test.ts`; `parseIntegrationParams` is how callers reach it.
export const integrationParamsSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("evcc-ingest"), params: evccIngestParamsSchema }),
  z.object({ kind: z.literal("ha-export"), params: haExportParamsSchema }),
]);
export type IntegrationParams = z.infer<typeof integrationParamsSchema>;

/**
 * A stored row's `kind` column and `params` jsonb, validated together.
 *
 * THROWS on a kind this build does not know, deliberately: see the header on why
 * a silent default is the wrong answer for a row. The mirror of
 * `./connection-kinds.ts`'s `parseConnectionParams`, and for the same reasons.
 */
export function parseIntegrationParams(kind: unknown, params: unknown): IntegrationParams {
  return integrationParamsSchema.parse({ kind, params });
}
