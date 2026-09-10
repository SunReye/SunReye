/**
 * WHAT A CONNECTION IS, PER KIND — the one discriminated union behind
 * `connections.kind` + `connections.params`.
 *
 * `connections` was Modbus-only: `host`, `port`, `transport`, `timeout_ms` and
 * `poll_interval_ms` as typed columns, and a doc comment calling the row "a
 * Modbus ENDPOINT". Everything else that dials something — the MQTT broker the
 * HA export publishes to and the EVCC ingest subscribes on — lived in
 * `app_settings.mqtt` instead, which meant every MQTT-fed device sat at
 * `connection_id = null` and fell into the "No connection" group on the settings
 * page. Two EVCC loadpoints then shared `unit_id = 0`, which the
 * `devices(connection_id, unit_id)` unique index tolerated ONLY because the
 * connection was null.
 *
 * So the endpoint fields became `params` jsonb under a `kind`, and the broker
 * became a connection kind. Two consequences worth stating:
 *
 *  - MORE THAN ONE BROKER becomes possible for free. The EVCC ingest reads its
 *    broker from its own connection, so a second EVCC on a second broker is two
 *    rows rather than a schema change.
 *  - `unit_id` BECOMES MEANINGFUL for a pushed device: a loadpoint's index. The
 *    unique index then holds for two loadpoints on one broker, which is what it
 *    was always supposed to express.
 *
 * WHY `kind` IS TEXT + CHECK AND NOT A POSTGRES ENUM
 *
 * See `./schema/plants.ts`. Adding `http` later is a CHECK rewrite inside a
 * transaction; `ALTER TYPE … ADD VALUE` is not, and cannot be rolled back.
 *
 * WHY A DISCRIMINATED UNION IS SAFE HERE AND NOT IN `app_settings`
 *
 * `readSetting` safe-parses to the DEFAULT with no log, so a
 * `z.discriminatedUnion` over a settings document silently resets the whole
 * document when one arm's field drifts (see the settings-schema-silent-reset
 * note). These are ROWS. {@link parseConnectionParams} THROWS on a kind it does
 * not know, and the callers surface that — a database migrated ahead of this
 * build is loud, never coerced to `modbus`.
 *
 * Shared by the server (repository, runtime tiers, routes) and the web app (the
 * add-connection dialog, which switches its fields on `kind`).
 */

import { z } from "zod";

/**
 * Every connection kind this build can open.
 *
 * The CHECK constraint on `connections.kind` is rendered from this list
 * (`./schema/plants.ts`), and `apps/server/db-tests/check-constraints.test.ts`
 * proves the engine agrees. A third value arrives as: an entry here, an arm
 * below, a tier in `apps/server/src/devices/connection-tier.ts`, and a CHECK
 * rewrite migration. No column changes.
 */
export const CONNECTION_KINDS = ["modbus", "mqtt"] as const;
export type ConnectionKind = (typeof CONNECTION_KINDS)[number];

/**
 * The framing modes the Modbus client actually implements.
 *
 * This used to be a CHECK on `connections.transport`. It is not expressible as
 * one on a jsonb field worth the trouble, so the constraint is HERE and the
 * repository refuses a write that fails it — a third value is not a validation
 * nicety, the client has no branch for it and the endpoint simply never polls.
 */
// fallow-ignore-next-line unused-export -- the framing list the add-connection dialog renders; the web half of #217 ships separately.
export const MODBUS_TRANSPORTS = ["tcp", "rtu-over-tcp"] as const;
export type ModbusTransport = (typeof MODBUS_TRANSPORTS)[number];

/**
 * A Modbus endpoint's addressing — the five columns this replaces, with the same
 * defaults the columns carried.
 */
export const modbusParamsSchema = z.object({
  host: z.string().trim().min(1, "host is required"),
  port: z.number().int().min(1).max(65535).default(502),
  transport: z.enum(MODBUS_TRANSPORTS).default("tcp"),
  /** Per-request Modbus timeout, ms. */
  timeoutMs: z.number().int().min(100).max(60_000).default(2000),
  /** Poll cadence for this endpoint, ms. Floored at 1000, as the runtime floors it. */
  pollIntervalMs: z.number().int().min(1000).max(3_600_000).default(1000),
});
export type ModbusParams = z.infer<typeof modbusParamsSchema>;

/**
 * An MQTT broker's endpoint.
 *
 * `password` is WRITE-ONLY over the API, exactly as `app_settings.mqtt`'s was:
 * {@link maskConnectionParams} strips it on read and
 * {@link mergeConnectionParams} preserves the stored one when a write omits it.
 * Nothing here is `enabled`: a connection exists or it does not, and what is
 * bound to it decides whether it is opened.
 */
export const mqttParamsSchema = z.object({
  brokerUrl: z.string().trim().min(1, "broker URL is required"),
  username: z.string().optional(),
  password: z.string().optional(),
  /**
   * The client id to dial with, or absent to let the library generate one.
   *
   * Optional because a broker that pins client ids is the exception — but when
   * two SunReye instances share a broker, a generated id is the difference
   * between two subscribers and one that keeps kicking the other off.
   */
  clientId: z.string().trim().min(1).optional(),
});
export type MqttParams = z.infer<typeof mqttParamsSchema>;

/**
 * THE union. One `z.discriminatedUnion` on `kind`, and the only place the two
 * param shapes are related to each other.
 */
export const connectionParamsSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("modbus"), params: modbusParamsSchema }),
  z.object({ kind: z.literal("mqtt"), params: mqttParamsSchema }),
]);
export type ConnectionParams = z.infer<typeof connectionParamsSchema>;

/** The label every connection carries, whatever its kind. */
const nameSchema = z.string().trim().min(1, "name is required").max(64);

/**
 * A connection as a writer states it: the label, plus the discriminated params.
 *
 * The union is repeated rather than intersected with `{ name }` because
 * `z.discriminatedUnion` needs object arms to keep narrowing on `kind` — an
 * intersection erases the discriminant for the parser and every consumer that
 * switches on it.
 */
export const connectionSettingsSchema = z.discriminatedUnion("kind", [
  z.object({ name: nameSchema, kind: z.literal("modbus"), params: modbusParamsSchema }),
  z.object({ name: nameSchema, kind: z.literal("mqtt"), params: mqttParamsSchema }),
]);
// fallow-ignore-next-line unused-type -- the add-connection dialog's body type; the web half of #217 ships separately.
export type ConnectionSettingsInput = z.infer<typeof connectionSettingsSchema>;

/**
 * A stored row's `kind` column and `params` jsonb, validated together.
 *
 * THROWS on a kind this build does not know, deliberately: see the header on
 * why a silent default is the wrong answer for a row.
 */
export function parseConnectionParams(kind: unknown, params: unknown): ConnectionParams {
  return connectionParamsSchema.parse({ kind, params });
}

/** The mqtt arm as the API returns it: no password, only whether one is set. */
export type MqttParamsMasked = Omit<MqttParams, "password"> & { hasPassword: boolean };

/** API-safe params. The modbus arm is unchanged — it holds no secret. */
export type ConnectionParamsMasked =
  | { kind: "modbus"; params: ModbusParams }
  | { kind: "mqtt"; params: MqttParamsMasked };

/** Strip every write-only field, so the shape is safe to return and to export. */
export function maskConnectionParams(connection: ConnectionParams): ConnectionParamsMasked {
  if (connection.kind === "modbus") return connection;
  const { password, ...rest } = connection.params;
  return { kind: "mqtt", params: { ...rest, hasPassword: Boolean(password) } };
}

/**
 * Merge an API write over the stored params.
 *
 * The write-only password is the whole reason this exists: the UI reads the
 * masked shape, edits a field and sends it back WITHOUT a password, and a plain
 * replacement would silently clear the broker's credential. An absent OR empty
 * incoming password means "leave the existing one unchanged".
 *
 * A KIND CHANGE CARRIES NOTHING OVER. The two arms share no field, so there is
 * nothing to preserve and preserving anything would be a leak: the old broker's
 * password must not survive on a row that is now a Modbus endpoint.
 */
export function mergeConnectionParams(
  existing: ConnectionParams,
  input: ConnectionParams,
): ConnectionParams {
  if (input.kind !== "mqtt" || existing.kind !== "mqtt") return input;
  const password = input.params.password || existing.params.password;
  return {
    kind: "mqtt",
    params: password === undefined ? input.params : { ...input.params, password },
  };
}
