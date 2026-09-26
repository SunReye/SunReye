import { describe, expect, test } from "bun:test";

import { SETUP_STEPS, stepIndex } from "./setup-steps";

describe("the first-run journey is one rail across two pages", () => {
  // /onboarding creates the account and /setup does the rest. They used to
  // show different things — no rail at all, then a three-step one starting at
  // "Profile" — so the account step read as a separate product.
  test("account comes first, then profile, connection and activation", () => {
    expect(SETUP_STEPS.map((s) => s.key)).toEqual(["account", "profile", "connect", "activate"]);
  });

  test("each step's index is its place on the rail", () => {
    expect(stepIndex("account")).toBe(0);
    expect(stepIndex("profile")).toBe(1);
    expect(stepIndex("connect")).toBe(2);
    expect(stepIndex("activate")).toBe(3);
  });

  test("every step has a label", () => {
    for (const step of SETUP_STEPS) expect(step.label().length).toBeGreaterThan(0);
  });
});
