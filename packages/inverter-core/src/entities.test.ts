import { describe, expect, test } from "bun:test";

import { entityConstraint, metricByKey, writableMetrics } from "./entities";
import type { InverterProfile, MetricDef } from "./types";

/** A read-only U_WORD metric; each test overrides only what it is about. */
const m = ({
  type = "U_WORD",
  addresses = [1],
  ...over
}: Partial<MetricDef> & { key: string }): MetricDef =>
  ({
    topic: over.key.replaceAll(".", "/"),
    label: over.key,
    unit: null,
    group: "inverter",
    type,
    addresses,
    // The legacy mirror stays in step with the binding, exactly as
    // `hydrateProfile` keeps it.
    binding: { via: "modbus", addr: addresses, type },
    scale: 1,
    access: "r",
    ...over,
  }) as MetricDef;

const profileOf = (metrics: MetricDef[]): InverterProfile => ({
  id: "acme",
  name: "Acme",
  manufacturer: "Acme",
  metrics,
});

describe("what an entity accepts", () => {
  test("a read/write register is writable", () => {
    expect(entityConstraint(m({ key: "settings.a", access: "rw" })).writable).toBe(true);
  });

  test("a read-only register is not writable", () => {
    expect(entityConstraint(m({ key: "battery.soc" })).writable).toBe(false);
  });

  test("a RAW register is never writable, even when the profile marks it rw", () => {
    // Packed system time has no single numeric value, so the numeric entity API
    // must refuse it rather than write a meaningless word.
    const raw = m({ key: "system.time", type: "RAW", access: "rw", addresses: [22, 23, 24] });

    expect(entityConstraint(raw).writable).toBe(false);
    expect(entityConstraint(raw).valueType).toBe("number");
  });

  test("a bounded number carries the profile's range as inclusive bounds", () => {
    const c = entityConstraint(
      m({ key: "settings.max_charge", access: "rw", range: { min: 0, max: 300 } }),
    );

    expect(c).toEqual({ writable: true, valueType: "number", min: 0, max: 300 });
  });

  test("a zero or negative bound is a bound, not a missing one", () => {
    // Battery power is signed and a 0 floor is meaningful; dropping either would
    // let a write past the physical limit through.
    const c = entityConstraint(
      m({ key: "settings.export_limit", access: "rw", range: { min: -5000, max: 0 } }),
    );

    expect(c.min).toBe(-5000);
    expect(c.max).toBe(0);
  });

  test("an unranged number is unbounded — validation stays open until the profile says otherwise", () => {
    const c = entityConstraint(m({ key: "settings.free", access: "rw" }));

    expect(c.min).toBeUndefined();
    expect(c.max).toBeUndefined();
    expect(c.valueType).toBe("number");
  });

  test("enum labels make the entity an enum whose permitted values are the raw keys", () => {
    const c = entityConstraint(
      m({
        key: "settings.work_mode",
        access: "rw",
        enumLabels: { 0: "Selling first", 1: "Zero export", 2: "Backup" },
      }),
    );

    expect(c.valueType).toBe("enum");
    // Numbers on the wire, not the JS object's string keys.
    expect(c.enumValues).toEqual([0, 1, 2]);
    expect(c.enumValues?.every((v) => typeof v === "number")).toBe(true);
  });

  test("a negative enum code survives the string-key round trip", () => {
    const c = entityConstraint(
      m({ key: "status.fault", enumLabels: { [-1]: "Unknown", 0: "OK" } }),
    );

    expect(c.enumValues).toContain(-1);
    expect(c.enumValues).toContain(0);
  });

  test("an enum entity reports no numeric bounds even when the profile declares a range", () => {
    const c = entityConstraint(
      m({
        key: "settings.work_mode",
        access: "rw",
        range: { min: 0, max: 2 },
        enumLabels: { 0: "Off", 1: "On" },
      }),
    );

    expect(c.valueType).toBe("enum");
    expect(c.min).toBeUndefined();
    expect(c.max).toBeUndefined();
  });

  test("an empty enum label map still reports an enum, with nothing permitted", () => {
    // Fail closed: an entity that lists no legal value must reject every write
    // rather than degrade into an unbounded number.
    const c = entityConstraint(m({ key: "status.x", access: "rw", enumLabels: {} }));

    expect(c.valueType).toBe("enum");
    expect(c.enumValues).toEqual([]);
  });
});

describe("the writable surface of a profile", () => {
  test("is exactly the rw, non-RAW metrics, in profile order", () => {
    const profile = profileOf([
      m({ key: "battery.soc" }),
      m({ key: "settings.a", access: "rw" }),
      m({ key: "system.time", type: "RAW", access: "rw" }),
      m({ key: "settings.b", access: "rw", enumLabels: { 0: "Off", 1: "On" } }),
    ]);

    expect(writableMetrics(profile).map((x) => x.key)).toEqual(["settings.a", "settings.b"]);
  });

  test("a composite control with no register of its own is still writable", () => {
    // Composite controls are addressless by design; the transport must expose
    // them or the UI loses every preset/lock.
    const profile = profileOf([
      m({
        key: "control.lock",
        access: "rw",
        addresses: [],
        controlExpr: { snapshotToggle: { target: "settings.a", lockedValue: 0 } },
      }),
    ]);

    expect(writableMetrics(profile).map((x) => x.key)).toEqual(["control.lock"]);
  });

  test("a read-only profile exposes no writable entity at all", () => {
    expect(writableMetrics(profileOf([m({ key: "battery.soc" })]))).toEqual([]);
  });

  test("a profile with no metrics exposes nothing", () => {
    expect(writableMetrics(profileOf([]))).toEqual([]);
  });
});

describe("indexing metrics by key", () => {
  test("finds each metric by its canonical key", () => {
    const soc = m({ key: "battery.soc" });
    const byKey = metricByKey(profileOf([soc, m({ key: "grid.power" })]));

    expect(byKey.get("battery.soc")).toBe(soc);
    expect(byKey.size).toBe(2);
  });

  test("an unknown key resolves to nothing rather than throwing", () => {
    expect(metricByKey(profileOf([m({ key: "battery.soc" })])).get("nope")).toBeUndefined();
  });

  test("an empty profile yields an empty index", () => {
    expect(metricByKey(profileOf([])).size).toBe(0);
  });
});
