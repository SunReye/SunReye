import { describe, expect, test } from "bun:test";

import { keptSelection } from "./profile-selection";

const profiles = [{ id: "deye-sun-12k" }, { id: "imported-a" }];

describe("the wizard's profile choice after the list reloads", () => {
  test("a choice still listed stays chosen", () => {
    expect(keptSelection(profiles, "imported-a")).toBe("imported-a");
  });

  // A stale id kept Continue enabled and was sent to the active-profile PUT.
  test("a choice no longer listed is cleared", () => {
    expect(keptSelection(profiles, "removed-b")).toBeNull();
  });

  test("an empty list clears any choice", () => {
    expect(keptSelection([], "imported-a")).toBeNull();
  });

  test("no choice stays none", () => {
    expect(keptSelection(profiles, null)).toBeNull();
  });
});
