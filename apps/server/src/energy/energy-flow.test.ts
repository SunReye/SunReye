import { describe, expect, test } from "bun:test";
import { type FlowLimits, flowStep } from "./energy-flow";

const open = (over: Partial<FlowLimits> = {}): FlowLimits => ({
  chargeCeilingW: Number.POSITIVE_INFINITY,
  headroomKwh: Number.POSITIVE_INFINITY,
  aboveFloorKwh: Number.POSITIVE_INFINITY,
  exportCeilingW: Number.POSITIVE_INFINITY,
  ...over,
});

describe("flowStep", () => {
  test("the house is served first; the split sums back to PV", () => {
    const f = flowStep(8000, 500, 0.25, open({ chargeCeilingW: 2000, exportCeilingW: 4000 }));
    expect(f).toEqual({ chargeW: 2000, dischargeW: 0, exportW: 4000, curtailedW: 1500 });
    expect(f.chargeW + f.exportW + f.curtailedW).toBe(8000 - 500);
  });

  test("charging is bounded by ceiling, surplus and the room left", () => {
    // 1 kWh of headroom over 15 min admits at most 4 kW.
    expect(flowStep(10_000, 0, 0.25, open({ headroomKwh: 1 })).chargeW).toBe(4000);
    expect(flowStep(3000, 0, 0.25, open()).chargeW).toBe(3000); // surplus-bound
    expect(flowStep(10_000, 0, 0.25, open({ chargeCeilingW: 500 })).chargeW).toBe(500);
  });

  test("a deficit discharges down to the floor, never charges", () => {
    // 2 kW short with only 0.3 kWh above the floor over 15 min → 1.2 kW.
    const f = flowStep(0, 2000, 0.25, open({ aboveFloorKwh: 0.3 }));
    expect(f).toEqual({ chargeW: 0, dischargeW: 1200, exportW: 0, curtailedW: 0 });
    expect(flowStep(0, 2000, 0.25, open({ aboveFloorKwh: 0 })).dischargeW).toBe(0);
  });

  test("a zero-width slice admits no battery movement", () => {
    const f = flowStep(5000, 8000, 0, open());
    expect(f.chargeW).toBe(0);
    expect(f.dischargeW).toBe(0);
  });

  test("negative readings clamp instead of leaking through", () => {
    const f = flowStep(-100, -50, 1, open());
    expect(f).toEqual({ chargeW: 0, dischargeW: 0, exportW: 0, curtailedW: 0 });
  });
});
