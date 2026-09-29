import { describe, expect, test } from "bun:test";
import { navItemIds } from "./nav-items";

describe("navItemIds", () => {
  const base = {
    isAdmin: false,
    controlCount: 0,
    automationsEnabled: false,
  } as const;

  test("an anonymous or non-admin viewer sees only the read-only areas", () => {
    expect(navItemIds(base)).toEqual(["overview", "history", "statistics"]);
  });

  test("controls appear for an admin once the device declares any", () => {
    expect(navItemIds({ ...base, isAdmin: true, controlCount: 3 })).toContain("controls");
    expect(navItemIds({ ...base, isAdmin: true, controlCount: 0 })).not.toContain("controls");
  });

  test("a non-admin never sees controls, however many the device declares", () => {
    expect(navItemIds({ ...base, isAdmin: false, controlCount: 9 })).not.toContain("controls");
  });

  test("automations stay out of the nav until the master gate is on", () => {
    expect(navItemIds({ ...base, isAdmin: true, automationsEnabled: false })).not.toContain(
      "automations",
    );
    expect(navItemIds({ ...base, isAdmin: true, automationsEnabled: true })).toContain(
      "automations",
    );
  });

  test("an enabled gate still does not expose automations to a non-admin", () => {
    expect(navItemIds({ ...base, isAdmin: false, automationsEnabled: true })).not.toContain(
      "automations",
    );
  });

  test("order is stable: automations last, after controls", () => {
    expect(navItemIds({ isAdmin: true, controlCount: 2, automationsEnabled: true })).toEqual([
      "overview",
      "history",
      "statistics",
      "controls",
      "automations",
    ]);
  });
});
