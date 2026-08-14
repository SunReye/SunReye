import { hydrateProfile, registerProfile, type ProfileData } from "@SunReye/inverter-core";
import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

// initProfiles reads the active-profile id from app_settings and the installed
// profiles from the DB. Mock both so we can drive the boot path without a DB.
//
// The spreads are load-bearing, not tidiness: `mock.module` is process-global
// and permanent, so a mock returning only the exports THIS suite needs deletes
// the rest for every test file that runs afterwards. One that omitted a single
// export broke a later file's import chain outright ("Export named ... not
// found"), which took that file's own mocks down with it and failed four
// unrelated tests. Override what the suite stubs; keep everything else real.
const realAppSettings = await import("../settings/app-settings");
const realProfiles = await import("./profiles");
const realDb = await import("@SunReye/db");

let activeId = "";
mock.module("../settings/app-settings", () => ({
  ...realAppSettings,
  readSetting: async () => ({ id: activeId }),
}));
mock.module("./profiles", () => ({
  ...realProfiles,
  dropLegacyDefaultSource: async () => {},
}));
mock.module("@SunReye/db", () => ({
  ...realDb,
  // loadInstalledProfiles does `await db.select().from(installedProfiles)`.
  db: { select: () => ({ from: async () => [] }) },
}));

const { initProfiles } = await import("./inverter");

const profile: ProfileData = {
  schemaVersion: 1,
  id: "installed-one",
  name: "Installed",
  manufacturer: "Test",
  version: "1.0.0",
  metrics: [
    {
      key: "battery.soc",
      topic: "battery/soc",
      label: "SOC",
      unit: "%",
      group: "battery",
      type: "U_WORD",
      addresses: [1],
      scale: 1,
      access: "r",
      role: "battery.soc",
    },
  ],
};

describe("initProfiles", () => {
  beforeEach(() => {
    activeId = "";
  });

  // `activeProfile` is module state in ./inverter and outlives this file, so a
  // suite that runs later and expects "nothing is active" (onboarding's
  // testInverter) would otherwise pass or fail purely on the order the runner
  // walked the files in. Leave the module as we found it.
  afterAll(async () => {
    activeId = "";
    await initProfiles();
  });

  test("boots onboarding-only (null) when the saved id is no longer installed", async () => {
    // Regression: an upgrade that dropped a formerly built-in package leaves a
    // stale active-profile id in app_settings. Boot must degrade, not crash.
    activeId = "gone-with-the-upgrade";
    await expect(initProfiles()).resolves.toBeNull();
  });

  test("resolves the active profile when it is registered", async () => {
    registerProfile(hydrateProfile(profile));
    activeId = "installed-one";
    const result = await initProfiles();
    expect(result?.id).toBe("installed-one");
  });
});
