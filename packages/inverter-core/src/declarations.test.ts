import { describe, expect, test } from "bun:test";

import { deriveCapabilities } from "./capabilities";
import { defineFamily, defineProfile, defineVariant, metric } from "./define";
import {
  hydrateProfile,
  PROFILE_SCHEMA_VERSIONS,
  type MetricDataDef,
  type ProfileData,
  type ProfileSchemaVersion,
} from "./profile-data";
import { safeParseProfileData } from "./schema";
import type { CanonicalRole } from "./types";

/** A v1 (`type` + `addresses`) metric — the shape every published profile uses. */
const legacyMetric = (key: string, role?: CanonicalRole): MetricDataDef => ({
  key,
  topic: key.replaceAll(".", "/"),
  label: key,
  unit: null,
  group: "inverter",
  type: "U_WORD",
  addresses: [500],
  scale: 1,
  access: "r",
  ...(role ? { role } : {}),
});

/** The same metric authored under the current vocabulary: addressing in `binding`. */
const currentMetric = (key: string, role?: CanonicalRole): MetricDataDef => ({
  ...legacyMetric(key, role),
  binding: { via: "modbus", addr: [500], type: "U_WORD" },
});

const profileOf = (metrics: MetricDataDef[], over: Partial<ProfileData> = {}): ProfileData =>
  ({
    schemaVersion: 1,
    id: "test",
    name: "Test",
    manufacturer: "ACME",
    version: "1.0.0",
    metrics,
    ...over,
  }) as ProfileData;

const issuesOf = (data: ProfileData): string[] => {
  const parsed = safeParseProfileData(data);
  return parsed.success ? [] : parsed.error.issues.map((i) => i.message);
};

const backupLoadOf = (data: ProfileData): boolean =>
  deriveCapabilities(hydrateProfile(data)).backupLoad;

describe("profile declarations — schema", () => {
  test("a v3 profile may declare a backup output", () => {
    const data = profileOf([currentMetric("load.power", "load.power")], {
      schemaVersion: 3,
      declares: { backupOutput: true },
    });
    expect(issuesOf(data)).toEqual([]);
  });

  test("a legacy profile may not declare: it predates the vocabulary", () => {
    const data = profileOf([legacyMetric("load.power", "load.power")], {
      declares: { backupOutput: true },
    });
    expect(issuesOf(data)).toContain("declares requires schemaVersion 3");
  });

  test("a v3 metric must still carry a binding", () => {
    const data = profileOf([legacyMetric("load.power", "load.power")], { schemaVersion: 3 });
    expect(issuesOf(data)).toContain("schemaVersion 3 requires a binding");
  });

  test("a v3 profile's binding fills the legacy mirror, exactly as v2's does", () => {
    // Addressing stated once, in the binding — the mirror is filled in for the
    // semantic lints, which must run on a v3 profile as they do on a v2 one.
    const { type: _type, addresses: _addresses, ...bindingOnly } = currentMetric("battery.soc");
    expect(issuesOf(profileOf([bindingOnly as MetricDataDef], { schemaVersion: 3 }))).toEqual([]);
  });
});

describe("schema versions", () => {
  test("the validator accepts every version the runtime lists", () => {
    for (const schemaVersion of PROFILE_SCHEMA_VERSIONS) {
      const metrics = [
        schemaVersion === 1 ? legacyMetric("battery.soc") : currentMetric("battery.soc"),
      ];
      expect(issuesOf(profileOf(metrics, { schemaVersion }))).toEqual([]);
    }
  });

  test("a version past the list is refused, not read as the newest", () => {
    const next = (PROFILE_SCHEMA_VERSIONS.at(-1) ?? 0) + 1;
    const data = profileOf([currentMetric("battery.soc")], {
      schemaVersion: next as ProfileSchemaVersion,
    });
    expect(issuesOf(data).length).toBeGreaterThan(0);
  });
});

describe("profile declarations — legacy upcast", () => {
  test("a legacy profile's load.* roles ARE its own load output", () => {
    // Every published v1/v2 profile was authored for a hybrid whose `load.*`
    // registers meter the inverter's UPS output. Keep them rendering a backup
    // section without asking their authors to re-publish.
    const data = profileOf([legacyMetric("load.power", "load.power")]);
    expect(hydrateProfile(data).declares?.backupOutput).toBe(true);
    expect(backupLoadOf(data)).toBe(true);
  });

  test("a legacy profile with no load role declares no backup output", () => {
    const data = profileOf([legacyMetric("pv.total.power", "pv.total.power")]);
    expect(hydrateProfile(data).declares?.backupOutput).toBeUndefined();
    expect(backupLoadOf(data)).toBe(false);
  });

  test("the upcast reads roles, not group names", () => {
    const data = profileOf([{ ...legacyMetric("load.raw"), group: "load" }]);
    expect(backupLoadOf(data)).toBe(false);
  });
});

describe("profile declarations — the current vocabulary", () => {
  test("a v3 profile mapping only load.power meters a house, not a UPS", () => {
    // The grid-tied case (SolarEdge/Sungrow SG + consumption meter): house load
    // is measured, and there is no backup output to render a section for.
    const data = profileOf([currentMetric("load.power", "load.power")], { schemaVersion: 3 });
    expect(backupLoadOf(data)).toBe(false);
  });

  test("a mapped backup.* role needs no declaration", () => {
    const data = profileOf([currentMetric("backup.power", "backup.power")], { schemaVersion: 3 });
    expect(backupLoadOf(data)).toBe(true);
  });

  test("declaring the output without metering it still renders the capability", () => {
    const data = profileOf([currentMetric("load.power", "load.power")], {
      schemaVersion: 3,
      declares: { backupOutput: true },
    });
    expect(backupLoadOf(data)).toBe(true);
  });

  test("an explicit false is honoured over any inference", () => {
    const data = profileOf([currentMetric("load.power", "load.power")], {
      schemaVersion: 3,
      declares: { backupOutput: false },
    });
    expect(backupLoadOf(data)).toBe(false);
  });
});

describe("profile declarations — authoring", () => {
  const soc = metric("battery/soc", {
    label: "SOC",
    group: "battery",
    addr: 588,
    unit: "%",
    role: "battery.soc",
  });

  test("an authored profile is emitted at the current schema version", () => {
    expect(
      defineProfile({ id: "x", name: "X", manufacturer: "ACME", version: "1.0.0", metrics: [soc] })
        .schemaVersion,
    ).toBe(3);
  });

  test("a declaration is carried into the emitted profile", () => {
    const data = defineProfile({
      id: "x",
      name: "X",
      manufacturer: "ACME",
      version: "1.0.0",
      metrics: [soc],
      declares: { backupOutput: true },
    });
    expect(data.declares).toEqual({ backupOutput: true });
    expect(issuesOf(data)).toEqual([]);
  });

  test("no declaration leaves the key off the emitted JSON entirely", () => {
    // An explicit `declares: undefined` would serialize as a key on some paths
    // and confuse a diff of the built output against its baseline.
    const data = defineProfile({
      id: "x",
      name: "X",
      manufacturer: "ACME",
      version: "1.0.0",
      metrics: [soc],
    });
    expect("declares" in data).toBe(false);
  });

  test("a variant inherits its base's declaration", () => {
    const base = defineProfile({
      id: "base",
      name: "B",
      manufacturer: "ACME",
      version: "1.0.0",
      metrics: [soc],
      declares: { backupOutput: true },
    });
    expect(defineVariant(base, { id: "model" }).declares).toEqual({ backupOutput: true });
  });

  test("a variant may restate it — a model without the backup output", () => {
    const base = defineProfile({
      id: "base",
      name: "B",
      manufacturer: "ACME",
      version: "1.0.0",
      metrics: [soc],
      declares: { backupOutput: true },
    });
    expect(
      defineVariant(base, { id: "grid-tied", declares: { backupOutput: false } }).declares,
    ).toEqual({
      backupOutput: false,
    });
  });

  test("a variant of a legacy base keeps what that base's load roles meant", () => {
    // Specializing a published v1/v2 profile must not silently drop its backup
    // output on the way to v3.
    const legacyBase = profileOf([legacyMetric("load.power", "load.power")]);
    expect(defineVariant(legacyBase, { id: "derived" }).declares).toEqual({ backupOutput: true });
  });

  test("every profile a family emits carries the family declaration", () => {
    const [base, ...models] = defineFamily({
      id: "fam",
      name: "F",
      manufacturer: "ACME",
      version: "1.0.0",
      metrics: [soc],
      declares: { backupOutput: true },
      models: { "fam-3p": { name: "F 3P" } },
    });
    expect(base?.declares).toEqual({ backupOutput: true });
    expect(models.map((m) => m.declares)).toEqual([{ backupOutput: true }]);
  });

  test("a family model may drop the output the family declares", () => {
    const emitted = defineFamily({
      id: "fam",
      name: "F",
      manufacturer: "ACME",
      version: "1.0.0",
      metrics: [soc],
      declares: { backupOutput: true },
      models: { "fam-gt": { name: "F GT", declares: { backupOutput: false } } },
    });
    expect(emitted.at(-1)?.declares).toEqual({ backupOutput: false });
  });
});
