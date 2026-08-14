import { hydrateProfile, registerProfile, type ProfileData } from "@SunReye/inverter-core";
import { beforeEach, describe, expect, mock, test } from "bun:test";

// initProfiles reads the active-profile id from app_settings and the installed
// profiles from the DB. Mock both so we can drive the boot path without a DB.
let activeId = "";
mock.module("../settings/app-settings", () => ({
  readSetting: async () => ({ id: activeId }),
}));
mock.module("./profiles", () => ({
  dropLegacyDefaultSource: async () => {},
}));
mock.module("@SunReye/db", () => ({
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
