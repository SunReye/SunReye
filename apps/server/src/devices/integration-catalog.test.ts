import { describe, expect, test } from "bun:test";
import type { ConnectionKind } from "@SunReye/db/connection-kinds";
import { z } from "zod";

import { codedIntegrations } from "./coded";
import {
  type CatalogEntry,
  type CatalogField,
  catalogFor,
  catalogViewFor,
  describeFields,
} from "./integration-catalog";

const ids = (entries: readonly CatalogEntry[]) => entries.map((e) => e.id);

const entry = (kind: ConnectionKind | null, id: string): CatalogEntry => {
  const found = catalogFor(kind).find((e) => e.id === id);
  if (!found) throw new Error(`no catalog entry ${id} on kind ${String(kind)}`);
  return found;
};

const field = (fields: readonly CatalogField[], name: string): CatalogField => {
  const found = fields.find((f) => f.name === name);
  if (!found) throw new Error(`no field ${name}`);
  return found;
};

describe("catalogFor", () => {
  test("a modbus connection offers exactly the profile-tier device", () => {
    const entries = catalogFor("modbus");
    expect(ids(entries)).toEqual(["modbus-device"]);
    expect(entries[0]?.via).toBe("profile");
  });

  test("an mqtt connection offers the EVCC ingest and the Home Assistant export", () => {
    expect(ids(catalogFor("mqtt"))).toEqual(["evcc-ingest", "ha-export"]);
  });

  test("an mqtt connection never offers HA entity import — that is HTTP (#80)", () => {
    expect(ids(catalogFor("mqtt"))).not.toContain("ha-import");
  });

  test("the null arm is DERIVED from the coded table, not a second list", () => {
    // The proof of derivation: the ids ARE the coded table's CONNECTION-LESS
    // keys, in its order. A weather declaration added to `./coded.ts` for #197
    // appears here with no edit to this module — and no assertion here needs
    // updating either.
    const connectionless = codedIntegrations().filter((c) => c.connectionless);
    expect(ids(catalogFor(null))).toEqual(connectionless.map((c) => c.profileId));
    expect(catalogFor(null).length).toBeGreaterThan(0);
  });

  test("the null arm holds ONLY connection-less declarations — never the EVCC loadpoint", () => {
    // A loadpoint is pushed over one particular broker and its device row
    // carries that connection's id. Listing it under "internal" offered an
    // operator an EVCC with no broker, which nothing would ever subscribe for.
    expect(ids(catalogFor(null))).not.toContain("evcc-loadpoint");
    expect(ids(catalogFor(null))).toContain("sunreye.optimizer");
  });

  test("the loadpoint declaration is still in the coded table — it is just not internal", () => {
    // The defect would come back as a DELETED declaration just as easily as a
    // wrong filter, and the runtime resolves loadpoint devices through it.
    const loadpoint = codedIntegrations().find((c) => c.profileId === "evcc-loadpoint");
    expect(loadpoint).toBeDefined();
    expect(loadpoint?.connectionless).toBe(false);
  });

  test("every coded declaration's label comes from the declaration itself", () => {
    const labels = catalogFor(null).map((e) => e.label);
    const connectionless = codedIntegrations().filter((c) => c.connectionless);
    expect(labels).toEqual(connectionless.map((c) => c.name));
  });

  test("every internal entry is via coded and not addable", () => {
    for (const e of catalogFor(null)) {
      expect(e.via).toBe("coded");
      expect(e.addable).toBe(false);
    }
  });

  test("an unknown kind yields an empty list rather than crashing", () => {
    expect(catalogFor("http" as ConnectionKind)).toEqual([]);
    expect(catalogViewFor("http" as ConnectionKind)).toEqual([]);
  });

  test("no entry, on any arm, declares capabilities", () => {
    const every = [...catalogFor("modbus"), ...catalogFor("mqtt"), ...catalogFor(null)];
    for (const e of every) {
      expect(Object.keys(e).sort()).toEqual([
        "addable",
        "fields",
        "id",
        "label",
        "multiInstance",
        "via",
      ]);
    }
  });
});

describe("addable and multiInstance", () => {
  test("a Modbus device is addable and may be added many times to one gateway", () => {
    const e = entry("modbus", "modbus-device");
    expect(e.addable).toBe(true);
    expect(e.multiInstance).toBe(true);
  });

  test("the EVCC ingest is addable and multi-instance", () => {
    const e = entry("mqtt", "evcc-ingest");
    expect(e.addable).toBe(true);
    expect(e.multiInstance).toBe(true);
    expect(e.via).toBe("coded");
  });

  test("the Home Assistant export is single-instance per connection", () => {
    const e = entry("mqtt", "ha-export");
    expect(e.addable).toBe(true);
    expect(e.multiInstance).toBe(false);
  });
});

describe("the field schemas", () => {
  test("a Modbus device takes a role, a profile and a unit id", () => {
    const parsed = entry("modbus", "modbus-device").fields.parse({
      role: "inverter",
      profileId: "deye.sun-12k",
      unitId: 1,
    });
    expect(parsed).toMatchObject({ role: "inverter", profileId: "deye.sun-12k", unitId: 1 });
  });

  test("a Modbus device carries the inverter PV and battery fields", () => {
    const parsed = entry("modbus", "modbus-device").fields.parse({
      role: "inverter",
      profileId: "deye.sun-12k",
      unitId: 1,
      arrays: [{ kwp: 9.8, tilt: 30, azimuth: 0 }],
      tempCoefficient: -0.4,
      systemLoss: 14,
      battery: { usableKwh: 10 },
    });
    expect(parsed.arrays).toHaveLength(1);
    expect(parsed.battery).toMatchObject({ usableKwh: 10 });
  });

  test("a unit id of 248 is refused — 248-255 are reserved and never a device", () => {
    const fields = entry("modbus", "modbus-device").fields;
    expect(fields.safeParse({ role: "inverter", profileId: "p", unitId: 248 }).success).toBe(false);
  });

  test("a negative unit id is refused", () => {
    const fields = entry("modbus", "modbus-device").fields;
    expect(fields.safeParse({ role: "inverter", profileId: "p", unitId: -1 }).success).toBe(false);
  });

  test("a unit id of 0 is accepted — a gateway that answers a lone slave on 0", () => {
    const fields = entry("modbus", "modbus-device").fields;
    expect(fields.safeParse({ role: "inverter", profileId: "p", unitId: 0 }).success).toBe(true);
  });

  test("the EVCC ingest takes a topic root", () => {
    expect(entry("mqtt", "evcc-ingest").fields.parse({ topicRoot: "evcc" })).toEqual({
      topicRoot: "evcc",
    });
  });

  test("an empty EVCC topic root is refused", () => {
    expect(entry("mqtt", "evcc-ingest").fields.safeParse({ topicRoot: "" }).success).toBe(false);
  });

  test("an over-long EVCC topic root is refused at 121 characters", () => {
    const fields = entry("mqtt", "evcc-ingest").fields;
    expect(fields.safeParse({ topicRoot: "e".repeat(120) }).success).toBe(true);
    expect(fields.safeParse({ topicRoot: "e".repeat(121) }).success).toBe(false);
  });

  test("the Home Assistant export takes a topic prefix and the discovery pair", () => {
    expect(
      entry("mqtt", "ha-export").fields.parse({
        topicPrefix: "sunreye",
        haDiscoveryEnabled: true,
        haDiscoveryPrefix: "homeassistant",
      }),
    ).toEqual({
      topicPrefix: "sunreye",
      haDiscoveryEnabled: true,
      haDiscoveryPrefix: "homeassistant",
    });
  });

  test("an EMPTY topic prefix is refused, and an ABSENT one falls to the record's default", () => {
    // Absent is not a refusal on purpose: these are the stored record's own
    // fields, reused rather than restated, and the record defaults them. The
    // boundary that matters is the one the record itself refuses.
    const fields = entry("mqtt", "ha-export").fields;
    expect(fields.safeParse({ topicPrefix: "" }).success).toBe(false);
    expect(fields.parse({})).toEqual({
      topicPrefix: "sunreye",
      haDiscoveryEnabled: false,
      haDiscoveryPrefix: "homeassistant",
    });
  });

  test("an empty discovery prefix is refused", () => {
    const fields = entry("mqtt", "ha-export").fields;
    expect(fields.safeParse({ haDiscoveryPrefix: "" }).success).toBe(false);
  });

  test("an internal entry configures nothing", () => {
    for (const e of catalogFor(null)) expect(e.fields.parse({})).toEqual({});
  });
});

describe("catalogViewFor", () => {
  const view = [...catalogViewFor("modbus"), ...catalogViewFor("mqtt"), ...catalogViewFor(null)];

  test("it is JSON-round-trippable — the wizard cannot receive zod objects", () => {
    expect(JSON.parse(JSON.stringify(view))).toEqual(view);
  });

  test("it carries the same entries and flags as the schema catalog", () => {
    expect(catalogViewFor("mqtt").map((e) => e.id)).toEqual(["evcc-ingest", "ha-export"]);
    const haExport = catalogViewFor("mqtt").find((e) => e.id === "ha-export");
    expect(haExport?.multiInstance).toBe(false);
    expect(haExport?.via).toBe("coded");
  });

  test("a bounded string reports its bounds and whether it is required", () => {
    const topicRoot = field(
      catalogViewFor("mqtt").find((e) => e.id === "evcc-ingest")?.fields ?? [],
      "topicRoot",
    );
    expect(topicRoot).toMatchObject({ type: "string", min: 1, max: 120, default: "evcc" });
    // Defaulted, so the wizard may omit it.
    expect(topicRoot.required).toBe(false);
  });

  test("a bounded integer reports its bounds", () => {
    const unitId = field(
      catalogViewFor("modbus").find((e) => e.id === "modbus-device")?.fields ?? [],
      "unitId",
    );
    expect(unitId).toMatchObject({ type: "number", min: 0, max: 247, required: true });
  });

  test("an enum reports its options", () => {
    const role = field(
      catalogViewFor("modbus").find((e) => e.id === "modbus-device")?.fields ?? [],
      "role",
    );
    expect(role.type).toBe("enum");
    expect(role.options).toContain("inverter");
    // The optimizer is auto-provisioned; nobody adds one over Modbus.
    expect(role.options).not.toContain("optimizer");
  });

  test("a boolean reports its default", () => {
    const flag = field(
      catalogViewFor("mqtt").find((e) => e.id === "ha-export")?.fields ?? [],
      "haDiscoveryEnabled",
    );
    expect(flag).toMatchObject({ type: "boolean", default: false, required: false });
  });

  test("the composite inverter fields are named without being expanded", () => {
    const fields = catalogViewFor("modbus").find((e) => e.id === "modbus-device")?.fields ?? [];
    expect(field(fields, "arrays")).toMatchObject({ type: "array", required: false, max: 8 });
    expect(field(fields, "battery")).toMatchObject({
      type: "object",
      required: false,
      nullable: true,
    });
  });

  test("an internal entry has no fields to render", () => {
    for (const e of catalogViewFor(null)) expect(e.fields).toEqual([]);
  });
});

describe("describeFields", () => {
  test("it omits absent facts rather than emitting undefined", () => {
    const [only] = describeFields(z.object({ plain: z.string() }));
    expect(Object.keys(only ?? {}).sort()).toEqual(["name", "required", "type"]);
  });

  test("an unsupported field type throws, naming the field and the type", () => {
    expect(() => describeFields(z.object({ when: z.date() }))).toThrow(/when.*date/);
  });

  test("an unsupported type behind a wrapper still throws", () => {
    expect(() => describeFields(z.object({ when: z.date().optional() }))).toThrow(/when.*date/);
  });
});
