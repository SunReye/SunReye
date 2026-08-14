import { inverterConfigSchema } from "@SunReye/db/inverter-config";
import { hydrateProfile, registerProfile, type ProfileData } from "@SunReye/inverter-core";
import { describe, expect, test } from "bun:test";
import { resolveProfileById } from "./inverter";
import { testInverter } from "./runtime";

// Onboarding runs before any profile is active, so the test-read path must
// resolve a *chosen* profile independently of the (unstarted) runtime. No
// profile ships in the box now, so register one in-process; resolving it hits
// the registry directly (DB-free), which is what we're exercising here.

const testProfile: ProfileData = {
  schemaVersion: 1,
  id: "test-builtin",
  name: "Test",
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

describe("resolveProfileById", () => {
  test("resolves a registered profile without touching the DB", async () => {
    registerProfile(hydrateProfile(testProfile));
    const profile = await resolveProfileById("test-builtin");
    expect(profile?.id).toBe("test-builtin");
  });
});

describe("testInverter", () => {
  test("reports no profile selected when none is chosen or active", async () => {
    // No profileId and no active profile (initProfiles never ran) → short-circuit
    // before any source is built, so no DB/socket is touched.
    const result = await testInverter(null, inverterConfigSchema.parse({}));
    expect(result.ok).toBe(false);
    expect(result.error).toBe("No profile selected");
  });
});
