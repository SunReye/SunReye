/**
 * `composePlant`'s own decisions: the discovery gate that must never throw, and the one
 * ingest the process installs. The lifecycle ORDER is `./plant-runtime.test.ts`.
 */

import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { noMigration } from "@SunReye/db/upgrade-state";
import { discoveryHeld, releaseDiscovery } from "../migration/discovery-gate";
import { createStreams } from "../shared/streams";

// mock-hygiene-ignore-next-line -- importing the real module boots Better Auth, which reads env and a database; avoiding that is the whole point of mocking it here. `auth` is its only export the server imports.
mock.module("@SunReye/auth", () => ({ auth: { api: { getSession: async () => null } } }));

const realRecord = await import("../migration/record");
const realRecordExports = { ...realRecord };
const realInstance = await import("../evcc/evcc-instance");
const realInstanceExports = { ...realInstance };
const realRuntime = await import("./plant-runtime");
const realRuntimeExports = { ...realRuntime };

let record: () => Promise<typeof noMigration> = async () => noMigration;
mock.module("../migration/record", () => ({
  ...realRecord,
  readMigrationRecord: () => record(),
}));

let installed: unknown = null;
mock.module("../evcc/evcc-instance", () => ({
  ...realInstance,
  installEvccIngest: (ingest: unknown) => {
    installed = ingest;
  },
}));

/** The deps `composePlant` handed `createPlantRuntime`, captured instead of booting a plant. */
let handed: Parameters<typeof realRuntime.createPlantRuntime>[0] | null = null;
mock.module("./plant-runtime", () => ({
  ...realRuntime,
  createPlantRuntime: (deps: Parameters<typeof realRuntime.createPlantRuntime>[0]) => {
    handed = deps;
    return { boot: async () => ({}) } as never;
  },
}));

afterAll(() => {
  mock.module("../migration/record", () => ({ ...realRecordExports }));
  mock.module("../evcc/evcc-instance", () => ({ ...realInstanceExports }));
  mock.module("./plant-runtime", () => ({ ...realRuntimeExports }));
});

const { composePlant } = await import("./plant-wiring");

function compose(profile: Parameters<typeof composePlant>[0]["profile"] = null) {
  const composed = composePlant({ profile, streams: createStreams() });
  if (!handed) throw new Error("createPlantRuntime was not called");
  return { composed, deps: handed };
}

beforeEach(() => {
  handed = null;
  installed = null;
  record = async () => noMigration;
});
afterEach(() => releaseDiscovery());

describe("composePlant", () => {
  test("hands the plant runtime the boot profile", () => {
    const profile = { id: "acme-1", name: "ACME", manufacturer: "ACME", metrics: [] };
    expect(compose(profile).deps.profile).toBe(profile);
    expect(compose(null).deps.profile).toBeNull();
  });

  test("installs the ingest it returns as the process's one", () => {
    const { composed } = compose();
    expect(installed).toBe(composed.evcc);
  });
});

describe("gateDiscovery", () => {
  test("holds discovery while a migration awaits its names", async () => {
    record = async () => ({ ...noMigration, stage: "cutover" });
    await compose().deps.gateDiscovery();
    expect(discoveryHeld()).toContain("names have not been confirmed");
  });

  test("leaves discovery open once the names are confirmed", async () => {
    record = async () => ({
      ...noMigration,
      stage: "cutover",
      namesConfirmedAt: "2026-09-01T00:00:00.000Z",
    });
    await compose().deps.gateDiscovery();
    expect(discoveryHeld()).toBeNull();
  });

  test("leaves discovery open on an install that never migrated", async () => {
    await compose().deps.gateDiscovery();
    expect(discoveryHeld()).toBeNull();
  });

  test("an unreadable record does not stop boot and does not hold discovery", async () => {
    record = async () => {
      throw new Error("relation app_settings does not exist");
    };
    await expect(compose().deps.gateDiscovery()).resolves.toBeUndefined();
    expect(discoveryHeld()).toBeNull();
  });
});
