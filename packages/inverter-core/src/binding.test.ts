import { describe, expect, test } from "bun:test";

import { decode, encodeWord } from "./codec";
import { planReads } from "./modbus-transport";
import {
  hydrateProfile,
  type ComputeExpr,
  type ControlExpr,
  type MetricDataDef,
  type ProfileData,
} from "./profile-data";
import { safeParseProfileData } from "./schema";
import type { Binding, MetricDef } from "./types";

/** A v1 (`type` + `addresses`) metric — the shape every published profile uses. */
const v1Metric = (over: Partial<MetricDataDef> & { key: string }): MetricDataDef => ({
  topic: over.key.replaceAll(".", "/"),
  label: over.key,
  unit: null,
  group: "inverter",
  type: "U_WORD",
  addresses: [500],
  scale: 1,
  access: "r",
  ...over,
});

const profileOf = (metrics: MetricDataDef[], schemaVersion: 1 | 2 = 1): ProfileData => ({
  schemaVersion,
  id: "binding-test",
  name: "Binding Test",
  manufacturer: "ACME",
  version: "1.0.0",
  metrics,
});

const bindingsOf = (data: ProfileData): Binding[] =>
  hydrateProfile(data).metrics.map((m) => m.binding);

describe("v1 -> v2 upcast (hydrateProfile)", () => {
  test("a single-register metric becomes a modbus binding", () => {
    expect(bindingsOf(profileOf([v1Metric({ key: "battery.soc", addresses: [588] })]))).toEqual([
      { via: "modbus", addr: [588], type: "U_WORD" },
    ]);
  });

  test("U_DWORD carries both words, RAW carries all of them", () => {
    expect(
      bindingsOf(
        profileOf([
          v1Metric({ key: "energy.total", type: "U_DWORD", addresses: [534, 535] }),
          v1Metric({ key: "inverter.time", type: "RAW", addresses: [22, 23, 24] }),
        ]),
      ),
    ).toEqual([
      { via: "modbus", addr: [534, 535], type: "U_DWORD" },
      { via: "modbus", addr: [22, 23, 24], type: "RAW" },
    ]);
  });

  test("an addressless computed metric becomes a compute binding, not an empty modbus one", () => {
    // Not `as const`: a readonly literal is not assignable to ComputeExpr, and
    // widening it here keeps the assertion below a plain value comparison.
    const expr: ComputeExpr = { sum: ["a.b"] };
    expect(
      bindingsOf(
        profileOf([
          v1Metric({ key: "a.b", addresses: [1] }),
          v1Metric({ key: "pv.power", addresses: [], computeExpr: expr }),
        ]),
      )[1],
    ).toEqual({ via: "compute", expr });
  });

  test("a control metric becomes a control binding", () => {
    const expr: ControlExpr = { preset: { writes: [{ target: "a.b", value: 1 }] } };
    expect(
      bindingsOf(
        profileOf([
          v1Metric({ key: "a.b", access: "rw", addresses: [1] }),
          v1Metric({ key: "lock", access: "rw", addresses: [], controlExpr: expr }),
        ]),
      )[1],
    ).toEqual({ via: "control", expr });
  });

  test("scale and offset stay on the metric, never inside the binding", () => {
    const [m] = hydrateProfile(
      profileOf([v1Metric({ key: "battery.temp", scale: 0.1, offset: -100 })]),
    ).metrics;
    expect(m).toMatchObject({ scale: 0.1, offset: -100 });
    expect(m?.binding).toEqual({ via: "modbus", addr: [500], type: "U_WORD" });
  });
});

describe("a v2 profile hydrates identically to its v1 twin", () => {
  const strip = (data: ProfileData) =>
    hydrateProfile(data).metrics.map(({ compute, ...rest }) => ({
      ...rest,
      computed: typeof compute === "function",
    }));

  test("modbus, compute and control arms all match", () => {
    const v1 = profileOf([
      v1Metric({ key: "a.b", addresses: [1], scale: 0.1, offset: -100, access: "rw" }),
      v1Metric({ key: "e.total", type: "U_DWORD", addresses: [2, 3] }),
      v1Metric({ key: "sum", addresses: [], computeExpr: { sum: ["a.b", "e.total"] } }),
      v1Metric({
        key: "lock",
        access: "rw",
        addresses: [],
        controlExpr: { snapshotToggle: { target: "a.b", lockedValue: 5 } },
      }),
    ]);
    // The same profile authored natively at v2: addressing lives only in `binding`.
    const v2 = profileOf(
      v1.metrics.map(({ type: t, addresses: a, computeExpr, controlExpr, ...rest }) => ({
        ...rest,
        binding: computeExpr
          ? ({ via: "compute", expr: computeExpr } as const)
          : controlExpr
            ? ({ via: "control", expr: controlExpr } as const)
            : ({ via: "modbus", addr: a, type: t } as const),
      })) as MetricDataDef[],
      2,
    );
    const parsed = safeParseProfileData(v2);
    expect(parsed.error?.issues).toBeUndefined();
    expect(strip(parsed.data as ProfileData)).toEqual(strip(v1));
  });
});

describe("bindings are validated at parse time", () => {
  const issuesOf = (data: unknown) => {
    const r = safeParseProfileData(data);
    expect(r.success).toBe(false);
    return JSON.stringify(r.error?.issues);
  };

  test("an unimplemented `via` is rejected when the profile is parsed", () => {
    expect(
      issuesOf(
        profileOf(
          [
            {
              ...v1Metric({ key: "a.b" }),
              binding: { via: "mqtt", topic: "x/y" },
            } as unknown as MetricDataDef,
          ],
          2,
        ),
      ),
    ).toContain("via");
  });

  test("a v2 metric without a binding is rejected", () => {
    expect(issuesOf(profileOf([v1Metric({ key: "a.b" })], 2))).toContain("binding");
  });

  test("a v1 metric carrying a binding is rejected — the upcast is one-way", () => {
    expect(
      issuesOf(
        profileOf([
          {
            ...v1Metric({ key: "a.b" }),
            binding: { via: "modbus", addr: [500], type: "U_WORD" },
          } as MetricDataDef,
        ]),
      ),
    ).toContain("binding");
  });

  test("a v1 profile still parses unchanged", () => {
    expect(safeParseProfileData(profileOf([v1Metric({ key: "a.b" })])).success).toBe(true);
  });
});

// The second arm that is not a register. Everything a `modbus` metric says about
// where its value lives — a type, a word count, an address range — is Modbus
// vocabulary; an HTTP body has one thing instead, the JSON pointer that picks the
// value out of it.
describe("the http binding arm", () => {
  const httpMetric = (pointer: string, over: Partial<MetricDataDef> = {}): MetricDataDef =>
    ({
      key: "grid.power",
      topic: "grid/power",
      label: "Grid power",
      unit: "W",
      group: "grid",
      scale: 1,
      access: "r",
      binding: { via: "http", pointer },
      ...over,
    }) as MetricDataDef;

  const issuesOf = (data: unknown) => {
    const r = safeParseProfileData(data);
    expect(r.success).toBe(false);
    return JSON.stringify(r.error?.issues);
  };

  test("parses and hydrates to the pointer it was authored with", () => {
    const data = profileOf([httpMetric("/em:0/total_act_power")], 2);

    expect(safeParseProfileData(data).success).toBe(true);
    expect(bindingsOf(data)).toEqual([{ via: "http", pointer: "/em:0/total_act_power" }]);
  });

  test("needs no registers, and its legacy mirror stays neutral rather than fictional", () => {
    // `type`/`addresses` are still required fields, so the upcast fills them —
    // but there is no register here, and the mirror must not pretend otherwise.
    const parsed = safeParseProfileData(profileOf([httpMetric("/em:0/total_act_power")], 2));
    const metric = (parsed.data as ProfileData).metrics[0]!;

    expect(metric.addresses).toEqual([]);
    expect(metric.type).toBe("U_WORD");
  });

  test("rejects addresses smuggled in beside the pointer", () => {
    expect(
      issuesOf(profileOf([httpMetric("/em:0/total_act_power", { addresses: [500] })], 2)),
    ).toContain("addresses");
  });

  test.each([
    ["no leading slash", "em:0/total_act_power"],
    ["the whole document", ""],
    ["a dangling escape", "/a~"],
    ["an undefined escape", "/a~2b"],
  ])("rejects %s as a pointer", (_label, pointer) => {
    expect(issuesOf(profileOf([httpMetric(pointer)], 2))).toContain("pointer");
  });

  test.each([
    ["an unescaped colon, which RFC 6901 does not escape", "/em:0/a_act_power"],
    ["an escaped slash and tilde", "/a~1b/~0c"],
    ["an array index", "/em:0/a_errors/0"],
    ["an empty reference token", "//x"],
  ])("accepts %s", (_label, pointer) => {
    expect(safeParseProfileData(profileOf([httpMetric(pointer)], 2)).success).toBe(true);
  });

  test.each([
    ["computed", { computeExpr: { sum: ["other"] } }],
    ["a control", { controlExpr: { preset: { writes: [{ target: "other", value: 1 }] } } }],
  ])("rejects a metric that is bound to a pointer and %s as well", (_label, over) => {
    // Two sources for one value: the pointer is read and then silently
    // overwritten by the derived value. Every other arm rejects this shape.
    expect(
      issuesOf(
        profileOf(
          [
            httpMetric("/em:0/total_act_power", over as Partial<MetricDataDef>),
            {
              ...v1Metric({ key: "other" }),
              binding: { via: "modbus", addr: [500], type: "U_WORD" },
            },
          ],
          2,
        ),
      ),
    ).toContain("http metric");
  });

  test("rejects a writable http metric — nothing can write one, so nothing may offer to", () => {
    // `access: "rw"` is what the entity layer, the MQTT bridge and the manifest
    // key their write surfaces off. HttpTransport refuses every write, so a
    // writable http metric is a control that cannot work.
    expect(
      issuesOf(profileOf([httpMetric("/em:0/total_act_power", { access: "rw" })], 2)),
    ).toContain("access");
  });

  test("is rejected on a v1 profile — the upcast is one-way for every arm", () => {
    // Authored as a v1 metric in every other respect, so the only thing left to
    // object to is the binding itself.
    const asV1 = httpMetric("/em:0/total_act_power", { type: "U_WORD", addresses: [] });

    expect(issuesOf(profileOf([asV1], 1))).toContain("binding requires schemaVersion 2");
  });

  test("is invisible to the Modbus path — nothing to plan, nothing to decode", () => {
    // The seam paying off: every Modbus site already asks the binding whether it
    // is a register, so a new arm costs the read planner and the codec nothing.
    const metrics = hydrateProfile(
      profileOf(
        [
          httpMetric("/em:0/total_act_power"),
          {
            ...v1Metric({ key: "a.b", addresses: [1] }),
            binding: { via: "modbus", addr: [1], type: "U_WORD" },
          },
        ],
        2,
      ),
    ).metrics;

    // The register metric beside it is planned exactly as it always was.
    expect(planReads(metrics)).toEqual([{ start: 1, count: 1 }]);
    expect(decode(metrics[0]!, new Map([[0, 7]]))).toBeUndefined();
  });
});

describe("the codec reads its addressing from the binding", () => {
  const def = (binding: Binding, over: Partial<MetricDef> = {}): MetricDef => ({
    key: "x",
    topic: "x",
    label: "x",
    unit: null,
    group: "inverter",
    // Legacy mirror deliberately points elsewhere: the codec must ignore it.
    type: "U_WORD",
    addresses: [9999],
    scale: 1,
    access: "r",
    binding,
    ...over,
  });

  test("decode uses binding.addr and binding.type, not the legacy mirror", () => {
    const regs = new Map([
      [10, 40000],
      [11, 1],
    ]);
    expect(decode(def({ via: "modbus", addr: [10], type: "U_WORD" }), regs)).toBe(40000);
    expect(decode(def({ via: "modbus", addr: [10], type: "S_WORD" }), regs)).toBe(40000 - 0x10000);
    expect(decode(def({ via: "modbus", addr: [10, 11], type: "U_DWORD" }), regs)).toBe(
      40000 + 0x10000,
    );
    expect(decode(def({ via: "modbus", addr: [10, 11], type: "RAW" }), regs)).toBeUndefined();
  });

  test("a non-modbus binding has nothing to decode", () => {
    expect(
      decode(def({ via: "compute", expr: { sum: ["a"] } }), new Map([[9999, 7]])),
    ).toBeUndefined();
  });

  test("encodeWord takes the register type from the binding", () => {
    expect(encodeWord(def({ via: "modbus", addr: [10], type: "S_WORD" }), -1)).toBe(0xffff);
    expect(() => encodeWord(def({ via: "modbus", addr: [10], type: "U_WORD" }), -1)).toThrow(
      RangeError,
    );
  });

  // The whole point of validating agreement: an author patches an address and
  // forgets to re-derive the binding. Whichever one the runtime reads, the other
  // is a lie — and the width/duplicate-address lints run against the mirror, so
  // a stale mirror silently mis-lints too. This must be rejected, not resolved
  // by precedence.
  test("a v2 binding that disagrees with type/addresses is rejected", () => {
    const result = safeParseProfileData({
      schemaVersion: 2,
      id: "disagree",
      name: "Disagree",
      manufacturer: "ACME",
      version: "1.0.0",
      metrics: [
        {
          key: "a.b",
          topic: "a/b",
          label: "A B",
          unit: null,
          group: "misc",
          type: "U_WORD",
          addresses: [9],
          binding: { via: "modbus", addr: [1], type: "U_WORD" },
          scale: 1,
          access: "r",
        },
      ],
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(JSON.stringify(result.error.issues)).toContain("binding disagrees");
  });

  test("a v2 binding that agrees with type/addresses is accepted", () => {
    // The negative twin: without it, the rule above could be satisfied by
    // rejecting every v2 profile that states both.
    const result = safeParseProfileData({
      schemaVersion: 2,
      id: "agree",
      name: "Agree",
      manufacturer: "ACME",
      version: "1.0.0",
      metrics: [
        {
          key: "a.b",
          topic: "a/b",
          label: "A B",
          unit: null,
          group: "misc",
          type: "U_WORD",
          addresses: [1],
          binding: { via: "modbus", addr: [1], type: "U_WORD" },
          scale: 1,
          access: "r",
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  test("a v2 metric stating only a binding is accepted and needs no mirror", () => {
    const result = safeParseProfileData({
      schemaVersion: 2,
      id: "binding-only",
      name: "Binding only",
      manufacturer: "ACME",
      version: "1.0.0",
      metrics: [
        {
          key: "a.b",
          topic: "a/b",
          label: "A B",
          unit: null,
          group: "misc",
          binding: { via: "modbus", addr: [1], type: "U_WORD" },
          scale: 1,
          access: "r",
        },
      ],
    });
    expect(result.success).toBe(true);
  });
});
