import { describe, expect, test } from "bun:test";
import {
  type AutomationState,
  type DeviceProfileBinding,
  automationStateKey,
  evccBoostLimitStateKey,
  evccModeStateKey,
  migrateAutomationState,
} from "./automation-state";

const CAPTURED = "2026-07-25T11:00:00Z";
const snap = (previousValue: number | string) => ({ previousValue, capturedAt: CAPTURED });

const bound = (deviceId: string, profileId: string): DeviceProfileBinding => ({
  deviceId,
  profileId,
});

describe("automation state keys", () => {
  test("every key an automation writes is namespaced by the DEVICE", () => {
    expect(automationStateKey("inv-1", "peakShaving")).toBe("inv-1:peakShaving");
    expect(evccModeStateKey("inv-1", 2)).toBe("inv-1:evccMode:2");
    expect(evccBoostLimitStateKey("inv-1", 2)).toBe("inv-1:evccBoostLimit:2");
  });
});

describe("migrateAutomationState", () => {
  test("a profile-keyed blob is adopted by the device bound to that profile", () => {
    const state: AutomationState = {
      "deye-sun-12k:peakShaving": snap(120),
      "deye-sun-12k:peakShaving:sell": snap(8000),
      "deye-sun-12k:evccMode:1": snap("pv"),
      "deye-sun-12k:evccBoostLimit:1": snap(30),
    };

    const result = migrateAutomationState(state, [bound("inv-1", "deye-sun-12k")]);

    expect(result.changed).toBe(true);
    expect(result.orphans).toEqual([]);
    expect(result.state).toEqual({
      "inv-1:peakShaving": snap(120),
      "inv-1:peakShaving:sell": snap(8000),
      "inv-1:evccMode:1": snap("pv"),
      "inv-1:evccBoostLimit:1": snap(30),
    });
  });

  test("migrating twice changes nothing the second time", () => {
    const bindings = [bound("inv-1", "deye-sun-12k")];
    const once = migrateAutomationState({ "deye-sun-12k:peakShaving": snap(120) }, bindings);
    const twice = migrateAutomationState(once.state, bindings);

    expect(twice.changed).toBe(false);
    expect(twice.state).toEqual(once.state);
  });

  test("an already device-keyed blob is left exactly as it is", () => {
    const state: AutomationState = { "inv-1:peakShaving": snap(120) };
    const result = migrateAutomationState(state, [bound("inv-1", "deye-sun-12k")]);

    expect(result.changed).toBe(false);
    expect(result.orphans).toEqual([]);
    expect(result.state).toEqual(state);
  });

  test("an empty blob migrates to an empty blob", () => {
    const result = migrateAutomationState({}, [bound("inv-1", "deye-sun-12k")]);
    expect(result.changed).toBe(false);
    expect(result.state).toEqual({});
    expect(result.orphans).toEqual([]);
  });

  test("a blob holding both shapes at once migrates only the old half", () => {
    const state: AutomationState = {
      "inv-1:peakShaving": snap(120),
      "deye-sun-12k:peakShaving:sell": snap(8000),
    };
    const result = migrateAutomationState(state, [bound("inv-1", "deye-sun-12k")]);

    expect(result.changed).toBe(true);
    expect(result.state).toEqual({
      "inv-1:peakShaving": snap(120),
      "inv-1:peakShaving:sell": snap(8000),
    });
  });

  test("a device-keyed entry wins a collision, and the old one is kept as an orphan", () => {
    // Both shapes for the SAME slot: the device-keyed one is what the running
    // engine wrote last, so it is the truth — and the stale profile-keyed value
    // is still the user's own register value, so it is never dropped.
    const state: AutomationState = {
      "inv-1:peakShaving": snap(120),
      "deye-sun-12k:peakShaving": snap(90),
    };
    const result = migrateAutomationState(state, [bound("inv-1", "deye-sun-12k")]);

    expect(result.changed).toBe(false);
    expect(result.state).toEqual(state);
    expect(result.orphans).toEqual(["deye-sun-12k:peakShaving"]);
  });

  test("a profile no device binds any more is never silently dropped", () => {
    const state: AutomationState = { "retired-profile:peakShaving": snap(120) };
    const result = migrateAutomationState(state, [bound("inv-1", "deye-sun-12k")]);

    expect(result.changed).toBe(false);
    expect(result.state).toEqual(state);
    expect(result.orphans).toEqual(["retired-profile:peakShaving"]);
  });

  test("a profile two devices share cannot be adopted by either", () => {
    // A plant with two identical inverters: nothing in the blob says which one
    // held the register, and guessing would restore one device's value onto the
    // other's inverter.
    const state: AutomationState = { "deye-sun-12k:peakShaving": snap(120) };
    const result = migrateAutomationState(state, [
      bound("inv-1", "deye-sun-12k"),
      bound("inv-2", "deye-sun-12k"),
    ]);

    expect(result.changed).toBe(false);
    expect(result.state).toEqual(state);
    expect(result.orphans).toEqual(["deye-sun-12k:peakShaving"]);
  });

  test("a key with no namespace at all is left alone and reported", () => {
    const state: AutomationState = { peakShaving: snap(120) };
    const result = migrateAutomationState(state, [bound("inv-1", "deye-sun-12k")]);

    expect(result.changed).toBe(false);
    expect(result.state).toEqual(state);
    expect(result.orphans).toEqual(["peakShaving"]);
  });

  test("with no devices at all nothing is adopted and nothing is lost", () => {
    const state: AutomationState = { "deye-sun-12k:peakShaving": snap(120) };
    const result = migrateAutomationState(state, []);

    expect(result.changed).toBe(false);
    expect(result.state).toEqual(state);
    expect(result.orphans).toEqual(["deye-sun-12k:peakShaving"]);
  });

  test("a device whose slug IS a profile id keeps its own entries", () => {
    // Nothing forbids a slug that collides with some profile's id. The device
    // reading wins: a device-keyed entry is the shape the engine writes today.
    const state: AutomationState = { "inv-1:peakShaving": snap(120) };
    const result = migrateAutomationState(state, [
      bound("inv-1", "deye-sun-12k"),
      bound("inv-2", "inv-1"),
    ]);

    expect(result.changed).toBe(false);
    expect(result.orphans).toEqual([]);
    expect(result.state).toEqual(state);
  });
});
