import {
  hydrateProfile,
  parseProfileData,
  type Binding,
  type MetricDataDef,
  type MetricDef,
  type ProfileData,
} from "@SunReye/inverter-core";
import { describe, expect, test } from "bun:test";

// The real published Deye SG05LP3 profile, still at `schemaVersion: 1` — the
// artifact every existing installation actually loads. The binding refactor is a
// pure refactor only if *this* profile hydrates to the same runtime metrics it
// did before, so the parity check runs against it and not a toy fixture.
import sampleProfile from "./__fixtures__/sample-profile.json";

const deyeV1 = sampleProfile as unknown as ProfileData;

/** Runtime metrics with the compiled closure reduced to a comparable marker. */
const runtimeMetrics = (data: ProfileData) =>
  hydrateProfile(data).metrics.map(({ compute, ...rest }) => ({
    ...rest,
    computed: typeof compute === "function",
  }));

/** The binding the v1 metric describes, spelled out here rather than imported. */
function expectedBinding(m: MetricDataDef): Binding {
  if (m.controlExpr) return { via: "control", expr: m.controlExpr };
  if (m.computeExpr) return { via: "compute", expr: m.computeExpr };
  return { via: "modbus", addr: [...m.addresses], type: m.type };
}

describe("the real Deye v1 profile survives the binding refactor", () => {
  test("every hydrated metric is the pre-refactor metric plus its binding", () => {
    const hydrated = hydrateProfile(deyeV1).metrics;
    expect(hydrated.length).toBe(deyeV1.metrics.length);

    for (const [i, source] of deyeV1.metrics.entries()) {
      const { computeExpr, computeAggregate: _unused, ...preRefactor } = source;
      const got = hydrated[i] as MetricDef;
      const { compute, computeInputs, binding, ...rest } = got;
      // Unchanged: identity, units, the legacy register mirror, scale/offset,
      // access, role and every render field.
      expect(rest).toEqual(preRefactor);
      expect(binding).toEqual(expectedBinding(source));
      expect(typeof compute === "function").toBe(computeExpr !== undefined);
      if (computeExpr) expect(computeInputs?.length).toBeGreaterThan(0);
    }
  });

  test("the fixture really exercises every binding arm and both boundaries", () => {
    const bindings = hydrateProfile(deyeV1).metrics.map((m) => m.binding);
    const modbus = bindings.filter((b) => b.via === "modbus");
    expect(new Set(bindings.map((b) => b.via))).toEqual(new Set(["modbus", "compute", "control"]));
    expect(
      modbus.some((b) => b.via === "modbus" && b.type === "U_DWORD" && b.addr.length === 2),
    ).toBe(true);
    expect(modbus.some((b) => b.via === "modbus" && b.type === "RAW" && b.addr.length >= 3)).toBe(
      true,
    );
    // No non-modbus metric smuggles an empty address list into a modbus binding.
    expect(modbus.every((b) => b.via === "modbus" && b.addr.length > 0)).toBe(true);
  });

  test("the same profile authored natively at v2 hydrates identically", () => {
    const v2: ProfileData = {
      ...deyeV1,
      schemaVersion: 2,
      metrics: deyeV1.metrics.map((source) => {
        const binding = expectedBinding(source);
        const { type: _t, addresses: _a, computeExpr: _c, controlExpr: _k, ...shared } = source;
        return { ...shared, binding } as MetricDataDef;
      }),
    };
    // Parsing fills the legacy mirror from the binding, so the v2 profile is a
    // *description* of addressing, not a copy of it.
    expect(runtimeMetrics(parseProfileData(v2))).toEqual(runtimeMetrics(deyeV1));
  });
});
