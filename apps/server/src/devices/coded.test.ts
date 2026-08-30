import { describe, expect, test } from "bun:test";

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
