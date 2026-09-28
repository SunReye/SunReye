import { describe, expect, test } from "bun:test";
import { automationsGateFrom, loadAutomationsGate } from "./automations-gate";

describe("automationsGateFrom", () => {
  test("is on only when the config says so, explicitly", () => {
    expect(automationsGateFrom({ enabled: true })).toBe(true);
    expect(automationsGateFrom({ enabled: false })).toBe(false);
  });

  test("an absent, empty or non-object body is off", () => {
    expect(automationsGateFrom({})).toBe(false);
    expect(automationsGateFrom(null)).toBe(false);
    expect(automationsGateFrom(undefined)).toBe(false);
    // Elysia serializes a `null` handler return as an empty body, which Eden
    // hands back as `""` — not nullish, so a `!= null` guard would read it as
    // a payload (see api-payload.ts).
    expect(automationsGateFrom("")).toBe(false);
    expect(automationsGateFrom([])).toBe(false);
  });

  test("a truthy non-boolean does not open the gate", () => {
    // A drifted row safe-parsed by the server, or a stringly-typed proxy.
    expect(automationsGateFrom({ enabled: "true" })).toBe(false);
    expect(automationsGateFrom({ enabled: 1 })).toBe(false);
  });
});

describe("loadAutomationsGate", () => {
  test("does not even ask when the viewer is not an admin", async () => {
    let asked = 0;
    const gate = await loadAutomationsGate(false, async () => {
      asked += 1;
      return { enabled: true };
    });
    expect(gate).toBe(false);
    expect(asked).toBe(0);
  });

  test("reads the gate for an admin", async () => {
    expect(await loadAutomationsGate(true, async () => ({ enabled: true }))).toBe(true);
    expect(await loadAutomationsGate(true, async () => ({ enabled: false }))).toBe(false);
  });

  test("a failed request leaves the feature hidden rather than revealed", async () => {
    const gate = await loadAutomationsGate(true, async () => {
      throw new Error("401");
    });
    expect(gate).toBe(false);
  });
});
