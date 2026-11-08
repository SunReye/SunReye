import { describe, expect, test } from "bun:test";
import { navItemIds } from "./nav-items";

describe("navItemIds", () => {
  const base = {
    isAdmin: false,
    offers: () => true,
    controlCount: 0,
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

  test("automations appear for an admin, and only when the core serves them", () => {
    expect(navItemIds({ ...base, isAdmin: true })).toContain("automations");
    expect(
      navItemIds({ ...base, isAdmin: true, offers: (a) => a !== "automations" }),
    ).not.toContain("automations");
  });

  test("automations are never offered to a non-admin", () => {
    expect(navItemIds({ ...base, isAdmin: false })).not.toContain("automations");
  });

  test("order is stable: automations last, after controls", () => {
    expect(navItemIds({ ...base, isAdmin: true, controlCount: 2 })).toEqual([
      "overview",
      "history",
      "statistics",
      "controls",
      "automations",
    ]);
  });

  test("an area the engine does not serve is offered to nobody", () => {
    const everything = { isAdmin: true, controlCount: 2 };
    const without = (area: string) => navItemIds({ ...everything, offers: (a) => a !== area });
    expect(without("history")).not.toContain("history");
    expect(without("statistics")).not.toContain("statistics");
    expect(without("controls")).not.toContain("controls");
    expect(without("automations")).not.toContain("automations");
    expect(without("history")).toContain("statistics");
  });

  test("an engine serving no area still leaves the overview", () => {
    expect(navItemIds({ isAdmin: true, offers: () => false, controlCount: 2 })).toEqual([
      "overview",
    ]);
  });
});
