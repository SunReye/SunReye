/**
 * The transports' context, built for a REGISTERED DEVICE rather than for the
 * boot profile.
 *
 * `buildProfileContext`'s own suite (`./inverter.test.ts`) proves the profile
 * half — identity, the two key indexes, write validation — and stays untouched,
 * because none of that changes. What this file proves is the one thing #87
 * moves: the `capabilities` block a consumer reads off `/api/profile` is
 * `deriveCapabilities` applied to the device the registry holds, not to an
 * `InverterProfile`. A separate file, so the parity suite is provably unedited.
 *
 * No mocks: `./inverter`'s importable surface is pure — the database and the
 * settings reads live behind `initProfiles`, which nothing here calls.
 */

import { describe, expect, test } from "bun:test";

import {
  type MetricDef,
  type InverterProfile,
  deriveCapabilities,
  deviceInstance,
  instanceFromProfile,
} from "@SunReye/inverter-core";

import { buildProfileContext } from "./inverter";

/** A full wire-shaped def; only the capability-bearing fields are ever varied. */
function m(overrides: Partial<MetricDef> & { key: string }): MetricDef {
  return {
    topic: overrides.key.replaceAll(".", "/"),
    label: overrides.key,
    unit: null,
    group: "misc",
    type: "U_WORD",
    addresses: [0],
    binding: { via: "modbus", addr: [0], type: "U_WORD" },
    scale: 1,
    access: "r",
    ...overrides,
  } as MetricDef;
}

function profileWith(metrics: MetricDef[]): InverterProfile {
  return { id: "acme-1", name: "ACME 1", manufacturer: "ACME", metrics };
}

const PROFILE = profileWith([
  m({ key: "battery.soc", role: "battery.soc", unit: "%" }),
  m({ key: "grid.power", role: "grid.power", unit: "W" }),
]);

describe("buildProfileContext, given a device", () => {
  test("the manifest's capabilities are the device's, not the profile's", () => {
    // A device that binds only part of what its register map describes — what a
    // meter provisioned from a shared profile looks like, and what a tier with
    // no register map at all (#88, #172) will look like.
    const device = deviceInstance({
      id: "meter-1",
      deviceClass: "meter",
      integration: "profile",
      metrics: [{ key: "grid.power", unit: "W", group: "misc", access: "r", role: "grid.power" }],
    });

    const ctx = buildProfileContext(PROFILE, device);

    expect(ctx.manifest.capabilities).toEqual(deriveCapabilities(device));
    expect(ctx.manifest.capabilities.battery).toBe(false);
  });

  test("the profile-backed device reports exactly what the profile did", () => {
    const device = instanceFromProfile({
      id: "inverter-1",
      deviceClass: "inverter",
      integration: "profile",
      profile: PROFILE,
    });

    // The parity claim in one line: today's only tier changes nothing.
    expect(buildProfileContext(PROFILE, device).manifest).toEqual(
      buildProfileContext(PROFILE).manifest,
    );
  });

  test("the rest of the context is untouched by the device", () => {
    const device = deviceInstance({
      id: "meter-1",
      deviceClass: "meter",
      integration: "profile",
      metrics: [],
    });
    const ctx = buildProfileContext(PROFILE, device);

    // Identity, catalog and write validation come from the register map, which
    // is the only thing that carries a topic, a label, a range or a bound.
    expect(ctx.profile).toBe(PROFILE);
    expect(ctx.manifest.id).toBe("acme-1");
    expect([...ctx.defByKey.keys()]).toEqual(["battery.soc", "grid.power"]);
    expect([...ctx.metaByKey.keys()]).toEqual(["battery.soc", "grid.power"]);
    expect(ctx.validateWrite("battery.soc", 50)).toBe("Entity is not writable: battery.soc");
  });
});
