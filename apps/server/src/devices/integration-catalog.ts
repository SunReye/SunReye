/**
 * THE INTEGRATION CATALOG — what can attach to a connection of a given kind,
 * and with what settings.
 *
 * One question, answered by a LOOKUP: given `connections.kind`, which
 * integrations may sit on such a row, and what does their settings step ask
 * for. The `/settings/devices` wizard renders the answer; nothing in the wizard
 * knows the kinds by name.
 *
 * WHY THIS IS A TABLE AND NOT A `switch (kind)` IN THE WIZARD
 *
 * `http` is coming (#80: Home Assistant entity import over `/api/states`). A
 * `switch` would put the knowledge of every kind inside the one component that
 * should be generic, and adding the kind would mean editing the wizard, the
 * connection dialog and this logic at once — three places that can disagree,
 * and the disagreement shows up as an integration that exists on the server and
 * cannot be added on screen. Here, a kind is an arm of {@link CATALOG}.
 *
 * AND HA ENTITY IMPORT IS **HTTP**, NOT MQTT. It polls `/api/states` over the
 * REST API; the MQTT arm must never list it, and an operator with only a broker
 * configured must not be offered it. That is the whole point of keying by kind
 * rather than by "is Home Assistant involved".
 *
 * `via` IS THE TIER, NOT THE TRANSPORT
 *
 * `profile` (a register map installed from a git source), `coded` (a
 * declaration compiled into this server — `./coded.ts`) and `mapping` (a user's
 * own field mapping) are the three tiers a device can be authored in. Writing
 * `via: "modbus"` would conflate the tier with the transport, and it would rot
 * on the first profile-tier device that arrives over an `http` connection —
 * which is exactly what #80 is. Connection kind is a SEPARATE axis: it is the
 * key of this lookup, never a field of its rows.
 *
 * WHAT IS DELIBERATELY ABSENT: CAPABILITIES
 *
 * An entry carries field schemas and its status shape. It never says "has a
 * battery", and `./registry.ts` refuses the same thing on a `CodedDeclaration`
 * for the same reason: capability is DERIVED from the roles a device resolves
 * to, once, for every tier. If a catalog entry could declare one, the catalog
 * and the registry could disagree about the same device — and every consumer
 * would grow a branch to decide which of the two to believe.
 */

import type { ConnectionKind } from "@SunReye/db/connection-kinds";
import { evccConfigSchema } from "@SunReye/db/evcc-config";
import { mqttConfigSchema } from "@SunReye/db/mqtt-config";
import { z } from "zod";

import { codedIntegrations } from "./coded";
import {
  deviceRoleSchema,
  inverterFieldsSchema,
  profileIdSchema,
  unitIdSchema,
} from "./device-admin";

/**
 * The tier an integration is authored in — never the transport it arrives over.
 * See the header.
 */
export type IntegrationTier = "profile" | "coded" | "mapping";

/** The settings step of an entry: an object schema, possibly an empty one. */
export type FieldSchema = z.ZodObject<z.ZodRawShape>;

/** One thing an operator can have on a connection. */
export interface CatalogEntry {
  /** Stable catalog id. For an internal entry, the coded `profile_id` itself. */
  id: string;
  /** What to call it on screen. */
  label: string;
  /** Which tier authors it. */
  via: IntegrationTier;
  /**
   * Whether the wizard offers it.
   *
   * `false` for AUTO-PROVISIONED entries — the optimizer today, #197's weather
   * device next. They are listed because an operator who sees a device in the
   * roster must be able to find out what it is; they are not addable because
   * the server creates the row itself, and a second one is a duplicate nothing
   * would ever poll.
   */
  addable: boolean;
  /**
   * Whether MORE THAN ONE may sit on the SAME connection.
   *
   * `ha-export` is one per broker: it is a single publisher with a single topic
   * prefix, and a second would fight the first for every topic. `evcc-ingest`
   * is many: two EVCC instances on one broker under two topic roots is the
   * arrangement #217 made expressible.
   */
  multiInstance: boolean;
  /** The settings step's schema — reused from the record it writes, never restated. */
  fields: FieldSchema;
}

/**
 * The settings a Modbus device is added with.
 *
 * Reused from `./device-admin.ts`, which is what actually validates the write:
 * a second spelling here would be a form that offers a value the route then
 * refuses. The inverter PV and pack fields ride along because they are part of
 * the same step for the one role that has them.
 */
const modbusDeviceFields = z.object({
  role: deviceRoleSchema,
  profileId: profileIdSchema,
  unitId: unitIdSchema,
  ...inverterFieldsSchema,
});

/** EVCC's ingest: which topic root to subscribe under. The broker is the connection. */
const evccIngestFields = z.object({ topicRoot: evccConfigSchema.shape.topicRoot });

/** The Home Assistant export: what to publish under, and whether to announce it. */
const haExportFields = z.object({
  topicPrefix: mqttConfigSchema.shape.topicPrefix,
  haDiscoveryEnabled: mqttConfigSchema.shape.haDiscoveryEnabled,
  haDiscoveryPrefix: mqttConfigSchema.shape.haDiscoveryPrefix,
});

/** An auto-provisioned entry configures nothing: the server writes the row. */
const noFields = z.object({});

/**
 * The lookup. One arm per {@link ConnectionKind}, plus the null arm.
 *
 * Not typed as `Record<ConnectionKind, …>` on purpose: `kind` reaches this from
 * a database column, so an install migrated ahead of the build can hand over a
 * value no arm covers. That answers an empty list — the wizard offers nothing —
 * rather than throwing, because a connection this build cannot furnish is still
 * a row the page has to render.
 */
const CATALOG: Partial<Record<ConnectionKind, readonly CatalogEntry[]>> = {
  modbus: [
    {
      id: "modbus-device",
      label: "Modbus device",
      via: "profile",
      addable: true,
      multiInstance: true,
      fields: modbusDeviceFields,
    },
  ],
  mqtt: [
    {
      id: "evcc-ingest",
      label: "EVCC",
      via: "coded",
      addable: true,
      multiInstance: true,
      fields: evccIngestFields,
    },
    {
      id: "ha-export",
      label: "Home Assistant export",
      via: "coded",
      addable: true,
      multiInstance: false,
      fields: haExportFields,
    },
  ],
};

/**
 * The INTERNAL group: coded devices that sit at `connection_id = NULL`.
 *
 * PROJECTED from `./coded.ts`'s table rather than listed again. The optimizer
 * (#172) is connection-less by design and #197 adds at least one more (the
 * weather device); a hand-maintained copy of the coded ids here would drift on
 * the first of those PRs, silently — the device would work and simply never
 * appear on the page. Adding a row to `CODED_INTEGRATIONS` is the whole change.
 *
 * ONLY THE CONNECTION-LESS ONES. The projection used to take every coded
 * declaration, which put the EVCC LOADPOINT in this group — and a loadpoint is
 * connection-BOUND: it is pushed over one particular broker and its device row
 * carries that connection's id. Listing it as "internal" offered an operator an
 * EVCC with no broker, which nothing would ever subscribe for. The filter reads
 * the declaration's own `connectionless` flag, so the group stays DERIVED: a
 * declaration added to `./coded.ts` appears here, or does not, according to what
 * it says about itself, with no second list to keep in step.
 *
 * Rebuilt per call, so a declaration added to the table at import time by a
 * later module is still reflected, and so no caller holds a shared array.
 */
function internalEntries(): readonly CatalogEntry[] {
  return codedIntegrations()
    .filter((coded) => coded.connectionless)
    .map((coded) => ({
      id: coded.profileId,
      label: coded.name,
      via: "coded" as const,
      addable: false,
      multiInstance: false,
      fields: noFields,
    }));
}

/**
 * What may attach to a connection of this kind — or, for `null`, what exists
 * with no connection at all.
 *
 * The NULL ARM IS NOT AN EDGE CASE. "Internal" is a permanent group: the
 * optimizer has no endpoint and never will, and #197's weather device is the
 * same shape. A catalog that could only be asked about a connection would have
 * no way to name them.
 */
export function catalogFor(kind: ConnectionKind | null): readonly CatalogEntry[] {
  if (kind === null) return internalEntries();
  return CATALOG[kind] ?? [];
}

/**
 * The field types the wizard can render.
 *
 * Exactly the ones the entries above actually use, and no more — see
 * {@link describeFields} on why the list is short on purpose. `array` and
 * `object` are NOT expanded: the PV strings and the pack have their own
 * sub-editors, and a generic recursive descent would produce a form nobody
 * would ship.
 */
export type CatalogFieldType = "string" | "number" | "boolean" | "enum" | "array" | "object";

/**
 * One field, as JSON — everything the wizard needs to render an input and
 * nothing it does not.
 *
 * Every optional fact is OMITTED when absent rather than set to `undefined`, so
 * the value survives `JSON.stringify` unchanged. A descriptor that only
 * round-trips sometimes is a contract that breaks at the HTTP edge and nowhere
 * else.
 */
export interface CatalogField {
  name: string;
  type: CatalogFieldType;
  /** False when the schema defaults it or marks it optional. */
  required: boolean;
  /** The schema's own default, when it has one. */
  default?: unknown;
  /** Whether `null` is accepted — "no pack" is not the same as "unchanged". */
  nullable?: boolean;
  /** Inclusive lower bound: a number's minimum, a string's or array's length. */
  min?: number;
  max?: number;
  /** The accepted values, for an enum. */
  options?: readonly string[];
}

/** An entry as JSON: the same row, with its schema described instead of carried. */
export interface CatalogEntryView extends Omit<CatalogEntry, "fields"> {
  fields: readonly CatalogField[];
}

/** What a wrapper (optional / nullable / default) says about the field it wraps. */
interface Wrappers {
  required: boolean;
  nullable: boolean;
  hasDefault: boolean;
  defaultValue?: unknown;
}

/** Zod's internal shape, as read here. Narrow on purpose: only what is used. */
interface ZodInternals {
  _zod: {
    def: {
      type: string;
      innerType?: unknown;
      defaultValue?: unknown;
      entries?: Record<string, string>;
      checks?: readonly { _zod: { def: Record<string, unknown> } }[];
    };
  };
}

const internals = (schema: unknown): ZodInternals["_zod"]["def"] =>
  (schema as ZodInternals)._zod.def;

/**
 * Peel `optional`, `nullable` and `default` off a field, recording what each
 * one said, and return the schema underneath.
 */
function unwrap(schema: unknown): { inner: unknown; wrappers: Wrappers } {
  const wrappers: Wrappers = { required: true, nullable: false, hasDefault: false };
  let inner = schema;
  for (;;) {
    const def = internals(inner);
    if (def.type === "optional") wrappers.required = false;
    else if (def.type === "nullable") wrappers.nullable = true;
    else if (def.type === "default") {
      wrappers.required = false;
      wrappers.hasDefault = true;
      wrappers.defaultValue = def.defaultValue;
    } else return { inner, wrappers };
    inner = def.innerType;
  }
}

/** The bounds a schema's checks state, whatever kind of bound they are. */
function boundsOf(schema: unknown): { min?: number; max?: number } {
  const bounds: { min?: number; max?: number } = {};
  for (const check of internals(schema).checks ?? []) {
    const def = check._zod.def;
    const kind = def["check"];
    if (kind === "greater_than" || kind === "min_length") {
      bounds.min = (def["value"] ?? def["minimum"]) as number;
    } else if (kind === "less_than" || kind === "max_length") {
      bounds.max = (def["value"] ?? def["maximum"]) as number;
    }
  }
  return bounds;
}

const RENDERABLE = new Set<string>(["string", "number", "boolean", "enum", "array", "object"]);

/**
 * Describe one object schema's fields for the wire.
 *
 * DERIVED from the zod schema, never restated beside it: a descriptor written
 * by hand is a second source of truth for the same bound, and the two diverge
 * the first time one of them is edited.
 *
 * THROWS on a type it cannot render, deliberately. The supported set is exactly
 * what the three entries use today; silently omitting an unknown type would
 * ship a wizard step with an invisible required field, which fails at submit
 * with a validation error naming a control the operator never saw. A future
 * entry that needs a union or a date fails loudly, here, with the field named.
 */
// fallow-ignore-next-line unused-export -- the derivation itself, asserted directly in `./integration-catalog.test.ts` (a union, a date, a wrapped date); `catalogViewFor` is how production reaches it, and test files are not traced as consumers.
export function describeFields(schema: FieldSchema): readonly CatalogField[] {
  return Object.entries(schema.shape).map(([name, raw]) => {
    const { inner, wrappers } = unwrap(raw);
    const type = internals(inner).type;
    if (!RENDERABLE.has(type)) {
      throw new Error(
        `integration catalog: field "${name}" is a ${type}, which the wizard cannot render — ` +
          `add it to CatalogFieldType and teach describeFields how to describe it`,
      );
    }
    const entries = internals(inner).entries;
    const { min, max } = boundsOf(inner);
    return {
      name,
      type: type as CatalogFieldType,
      required: wrappers.required,
      ...(wrappers.hasDefault ? { default: wrappers.defaultValue } : {}),
      ...(wrappers.nullable ? { nullable: true } : {}),
      ...(min !== undefined ? { min } : {}),
      ...(max !== undefined ? { max } : {}),
      ...(entries ? { options: Object.values(entries) } : {}),
    };
  });
}

/**
 * {@link catalogFor}, as JSON — what a route returns.
 *
 * A zod object cannot cross the HTTP edge, and shipping one shape to the server
 * and a different hand-written one to the browser is how the two stop agreeing.
 */
export function catalogViewFor(kind: ConnectionKind | null): readonly CatalogEntryView[] {
  return catalogFor(kind).map(({ fields, ...entry }) => ({
    ...entry,
    fields: describeFields(fields),
  }));
}
