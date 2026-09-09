import { describe, expect, test } from "bun:test";

import type { StorageRow } from "./storage-policy";
import { createIdentifiedCommit, createRowIdentifier } from "./storage-identity";

/**
 * The one place a `StorageRow`'s NAMES become the int2 identity `metrics_raw` is
 * keyed by.
 *
 * It is tested without a database because it holds no SQL: the resolver is
 * injected, so what is under test is the batching (one lookup per source, one
 * registration for the whole batch), what happens to a row whose device does not
 * exist, and that the value/duration columns come through untouched.
 */
const row = (over: Partial<StorageRow> = {}): StorageRow => ({
  time: new Date("2026-01-01T00:00:00Z"),
  inverterId: "deye-1",
  metric: "pv.power",
  value: 1234,
  ...over,
});

function harness(devices: Record<string, number>, metrics: Record<string, number> = {}) {
  const lookups: string[] = [];
  const registered: string[][] = [];
  const warnings: string[] = [];
  const identifier = createRowIdentifier({
    resolver: {
      deviceId: async (source: string) => {
        lookups.push(source);
        return devices[source] ?? null;
      },
      metricIds: async (keys: readonly string[]) => {
        registered.push([...keys]);
        return new Map(keys.map((k) => [k, metrics[k] ?? 99]));
      },
    },
    logger: { warn: (template: string) => warnings.push(template) },
  });
  return { identifier, lookups, registered, warnings };
}

describe("identifying a batch", () => {
  test("turns the names into the ids the table is keyed by", async () => {
    const { identifier } = harness({ "deye-1": 3 }, { "pv.power": 41 });
    expect(await identifier.identify([row()])).toEqual([
      { time: new Date("2026-01-01T00:00:00Z"), deviceId: 3, metricId: 41, value: 1234 },
    ]);
  });

  test("carries dur_ms through — it is the writer's own record of what it observed", async () => {
    const { identifier } = harness({ "deye-1": 3 });
    const [out] = await identifier.identify([row({ durMs: 4000 })]);
    expect(out?.durMs).toBe(4000);
  });

  test("an ABSENT dur_ms stays absent — NULL means 'no duration was recorded'", async () => {
    // A config change-log row has no duration, and a default of 0 would be a
    // zero-width interval while 1 would claim a 1 ms hold nothing measured.
    const { identifier } = harness({ "deye-1": 3 });
    const [out] = await identifier.identify([row()]);
    expect(out).not.toHaveProperty("durMs");
  });

  test("a dur_ms of 0 is preserved as 0, not dropped as falsy", async () => {
    const { identifier } = harness({ "deye-1": 3 });
    const [out] = await identifier.identify([row({ durMs: 0 })]);
    expect(out?.durMs).toBe(0);
  });

  test("0 and negative values survive — an idle inverter and an export are readings", async () => {
    const { identifier } = harness({ "deye-1": 3 });
    const out = await identifier.identify([row({ value: 0 }), row({ value: -350.5 })]);
    expect(out.map((r) => r.value)).toEqual([0, -350.5]);
  });

  test("an EMPTY batch resolves nothing at all", async () => {
    // `ensureMetricKeys` on an empty spec list is a `VALUES` list with no rows —
    // a syntax error — and a lookup for a source nobody named is a wasted round
    // trip on the flush path.
    const { identifier, lookups, registered } = harness({ "deye-1": 3 });
    expect(await identifier.identify([])).toEqual([]);
    expect(lookups).toEqual([]);
    expect(registered).toEqual([]);
  });
});

describe("batching", () => {
  test("one device lookup per SOURCE, however many rows name it", async () => {
    const { identifier, lookups } = harness({ "deye-1": 3 });
    await identifier.identify([row(), row({ metric: "a" }), row({ metric: "b" })]);
    expect(lookups).toEqual(["deye-1"]);
  });

  test("one registration for the WHOLE batch, deduplicated", async () => {
    // The flush is up to 100 000 rows; a round trip per key would be the write
    // path this release re-keyed to make cheaper.
    const { identifier, registered } = harness({ "deye-1": 3 });
    await identifier.identify([row(), row(), row({ metric: "load.power" })]);
    expect(registered).toEqual([["pv.power", "load.power"]]);
  });
});

describe("a device that does not exist yet", () => {
  test("drops the row rather than failing the whole batch on a foreign key", async () => {
    // Nothing creates a `devices` row yet — provisioning belongs to the
    // onboarding wave — so a server can flush before its device exists. A NULL
    // `device_id` would violate `metrics_raw_device_id_devices_id_fk` and take
    // every OTHER row of the batch down with it.
    const { identifier } = harness({ known: 3 });
    const out = await identifier.identify([
      row({ inverterId: "known" }),
      row({ inverterId: "ghost" }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]?.deviceId).toBe(3);
  });

  test("says so, once per source — at 1 Hz an unbounded warning buries the log", async () => {
    const { identifier, warnings } = harness({});
    await identifier.identify([row()]);
    await identifier.identify([row()]);
    await identifier.identify([row({ inverterId: "other" })]);
    expect(warnings).toHaveLength(2);
  });

  test("warns again for a source that had resolved and then stopped resolving", async () => {
    // Not a cache: this is the boundary where a device is REMOVED under a running
    // server, and silence there would hide data loss.
    const devices: Record<string, number> = { "deye-1": 3 };
    const { identifier, warnings } = harness(devices);
    await identifier.identify([row()]);
    expect(warnings).toEqual([]);
    delete devices["deye-1"];
    await identifier.identify([row()]);
    expect(warnings).toHaveLength(1);
  });

  test("a batch naming only unknown devices is an empty list, never a throw", async () => {
    const { identifier } = harness({});
    expect(await identifier.identify([row(), row()])).toEqual([]);
  });
});

describe("the commit the runtime wires the buffers to", () => {
  /** Rows a fake `insert` received, in call order. */
  const inserts: unknown[][] = [];
  const commitWith = (resolved: unknown[]) =>
    createIdentifiedCommit({
      identify: async () => resolved as never,
      insert: async (rows) => {
        inserts.push(rows);
      },
    });

  test("inserts exactly the rows the identification produced", async () => {
    inserts.length = 0;
    const resolved = [{ time: new Date(0), deviceId: 3, metricId: 41, value: 1 }];
    await commitWith(resolved)([row()]);
    expect(inserts).toEqual([resolved]);
  });

  test("a batch that resolved to NOTHING issues no statement at all", async () => {
    // `INSERT ... VALUES` with no values is a syntax error, so the empty case has
    // to be a no-op rather than a statement — and it is reachable in production,
    // because a batch naming only unknown devices resolves to nothing.
    inserts.length = 0;
    await commitWith([])([row()]);
    expect(inserts).toEqual([]);
  });

  test("an EMPTY batch is also a no-op", async () => {
    inserts.length = 0;
    await commitWith([])([]);
    expect(inserts).toEqual([]);
  });
});
