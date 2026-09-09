import { describe, expect, test } from "bun:test";

import { OPTIMIZER_METRICS, OPTIMIZER_PROFILE } from "../automation/optimizer-device";
import { EVCC_LOADPOINT_PROFILE } from "../evcc/evcc-devices";
import { resolveCoded } from "./coded";

describe("the coded-integration table", () => {
  test("resolves an EVCC loadpoint by the profile id its device rows name", () => {
    const declaration = resolveCoded(EVCC_LOADPOINT_PROFILE);
    expect(declaration?.integration).toBe("evcc");
    expect(declaration?.metrics.map((m) => m.role)).toEqual([
      "ev.charge.power",
      "ev.vehicle.soc",
      "ev.session.energy",
      "ev.connected",
      "ev.charging",
    ]);
  });

  test("resolves the optimizer — a device with no machine behind it at all", () => {
    const declaration = resolveCoded(OPTIMIZER_PROFILE);
    expect(declaration?.integration).toBe("optimizer");
    // Every declaration is an `optimizer.*` decision and nothing else: the
    // plant's own measurements stay on the devices that measured them.
    expect(declaration?.metrics.every((m) => m.key.startsWith("optimizer."))).toBe(true);
    expect(declaration?.metrics.map((m) => m.key)).toEqual(OPTIMIZER_METRICS.map((m) => m.key));
  });

  test("an ordinary profile id is not a coded declaration", () => {
    // The answer that sends the registry on to the profile store. A table that
    // guessed here would shadow a real profile with a coded one.
    expect(resolveCoded("deye-sg04lp3")).toBeNull();
    expect(resolveCoded("")).toBeNull();
  });

  test("a prototype-polluting id is not a declaration either", () => {
    // The lookup key comes from a database column, so `constructor` and
    // `toString` reach this function. A plain object literal would answer with a
    // function for both.
    expect(resolveCoded("constructor")).toBeNull();
    expect(resolveCoded("__proto__")).toBeNull();
  });
});
