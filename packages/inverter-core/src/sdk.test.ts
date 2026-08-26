import { describe, expect, test } from "bun:test";

import { control, defineProfile, metric } from "./define";
import { resolveStorage } from "./capabilities";
import {
  compileComputeExpr,
  hydrateProfile,
  type MetricDataDef,
  type ProfileData,
} from "./profile-data";
import { ROLE_CATALOG, ROLE_NAMES } from "./roles";
import { profileDataSchema, safeParseProfileData } from "./schema";
import type { MetricStorage, RegisterType } from "./types";

/** A minimal valid profile built via the SDK, reused across cases. */
function goodProfile(): ProfileData {
  return defineProfile({
    id: "test-inv",
    name: "Test Inverter",
    manufacturer: "ACME",
    version: "1.0.0",
    metrics: [
      metric("dc/pv1/power", {
        label: "PV1",
        unit: "W",
        group: "inverter",
        addr: 672,
        role: "pv.string.power",
        index: 1,
      }),
      metric("dc/pv2/power", {
        label: "PV2",
        unit: "W",
        group: "inverter",
        addr: 673,
        role: "pv.string.power",
        index: 2,
      }),
      metric("battery/soc", {
        label: "SOC",
        unit: "%",
        group: "battery",
        addr: 588,
        role: "battery.soc",
      }),
      metric("inverter/status", {
        label: "Status",
        group: "inverter",
        addr: 500,
        role: "inverter.status",
        enumLabels: { 0: "Standby", 2: "Normal" },
      }),
      metric("settings/workmode", {
        label: "Work Mode",
        group: "settings",
        addr: 142,
        access: "rw",
        role: "setting.work_mode",
        enumLabels: { 0: "Selling First" },
      }),
      metric("dc/total_power", {
        label: "PV Total",
        unit: "W",
        group: "inverter",
        role: "pv.total.power",
        computeExpr: { sum: ["dc.pv1.power", "dc.pv2.power"] },
      }),
    ],
  });
}

describe("role catalog", () => {
  test("CanonicalRole vocabulary is complete and lists the expected roles", () => {
    // Guards against accidental deletion when editing the catalog.
    expect(ROLE_NAMES.length).toBe(57);
    for (const r of [
      "pv.string.power",
      "battery.power",
      "grid.power",
      "load.power",
      "backup.power",
      "grid.frequency",
      "pv.string.energy.today",
      "setting.work_mode",
      "inverter.power",
      "inverter.efficiency",
    ] as const) {
      expect(ROLE_CATALOG[r]).toBeDefined();
    }
  });

  test("indexed / writable / enum flags are set for representative roles", () => {
    expect(ROLE_CATALOG["pv.string.power"].indexed).toBe(true);
    // A per-string counter is both indexed and cumulative — one metric per MPPT.
    expect(ROLE_CATALOG["pv.string.energy.total"]).toMatchObject({
      indexed: true,
      kind: "cumulative",
    });
    expect(ROLE_CATALOG["setting.work_mode"].writable).toBe(true);
    expect(ROLE_CATALOG["inverter.status"].needsEnumLabels).toBe(true);
    expect(ROLE_CATALOG["battery.power"].signed).toBe(true);
  });
});

describe("metric() builder defaults", () => {
  test("derives key from topic and applies defaults", () => {
    const m = metric("ac/l1/power", { label: "L1", group: "inverter", addr: 633, type: "S_WORD" });
    expect(m.key).toBe("ac.l1.power");
    expect(m.type).toBe("S_WORD");
    expect(m.scale).toBe(1);
    expect(m.access).toBe("r");
    expect(m.unit).toBeNull();
    expect(m.addresses).toEqual([633]);
  });

  test("addressless computed metric", () => {
    const m = metric("dc/total_power", {
      label: "Total",
      group: "inverter",
      computeExpr: { sum: ["a", "b"] },
    });
    expect(m.addresses).toEqual([]);
    expect(m.computeExpr).toEqual({ sum: ["a", "b"] });
  });

  test("a pointer authors an http metric, with the register mirror left neutral", () => {
    const m = metric("grid/power", {
      label: "Grid power",
      group: "grid",
      unit: "W",
      pointer: "/em:0/total_act_power",
      role: "grid.power",
    });

    expect(m.binding).toEqual({ via: "http", pointer: "/em:0/total_act_power" });
    expect(m.addresses).toEqual([]);
  });

  test("refuses a metric that is both addressed and pointed at", () => {
    // Author-time, because it is a contradiction rather than a preference: the
    // value cannot live in register 633 and in a JSON body at once.
    expect(() =>
      metric("grid/power", {
        label: "Grid power",
        group: "grid",
        addr: 633,
        pointer: "/em:0/total_act_power",
      }),
    ).toThrow("both");
  });

  test("survives the emit-time binding re-derive that the mirror cannot express", () => {
    // `defineProfile` re-derives every binding from the final mirror fields so a
    // patched address cannot leave a stale binding behind. There is no mirror to
    // re-derive an http binding from, so it must be carried through untouched.
    const data = defineProfile({
      id: "meter",
      name: "Meter",
      manufacturer: "ACME",
      version: "1.0.0",
      metrics: [
        metric("grid/power", {
          label: "Grid power",
          group: "grid",
          unit: "W",
          pointer: "/em:0/total_act_power",
          role: "grid.power",
        }),
      ],
    });

    expect(data.metrics[0]?.binding).toEqual({
      via: "http",
      pointer: "/em:0/total_act_power",
    });
    expect(safeParseProfileData(data).success).toBe(true);
  });
});

describe("profileDataSchema", () => {
  test("accepts a well-formed profile", () => {
    expect(profileDataSchema.safeParse(goodProfile()).success).toBe(true);
  });

  test("rejects duplicate metric keys", () => {
    const p = goodProfile();
    p.metrics.push({ ...p.metrics[1]!, addresses: [999] }); // same key as pv2
    expect(safeParseProfileData(p).success).toBe(false);
  });

  test("rejects duplicate wire addresses", () => {
    const p = goodProfile();
    setAddressing(p, 2, { addresses: [672] }); // clash with pv1 power
    expect(safeParseProfileData(p).success).toBe(false);
  });

  test("rejects an indexed role without index", () => {
    const p = goodProfile();
    delete p.metrics[0]!.index;
    expect(safeParseProfileData(p).success).toBe(false);
  });

  test("rejects an enum role without enumLabels", () => {
    const p = goodProfile();
    delete p.metrics[3]!.enumLabels;
    expect(safeParseProfileData(p).success).toBe(false);
  });

  test("rejects a writable role that is not rw", () => {
    const p = goodProfile();
    p.metrics[4]!.access = "r";
    expect(safeParseProfileData(p).success).toBe(false);
  });

  test("rejects a U_DWORD without exactly two addresses", () => {
    const p = goodProfile();
    setAddressing(p, 2, { type: "U_DWORD" }); // soc has a single address
    expect(safeParseProfileData(p).success).toBe(false);
  });

  test("rejects computeExpr referencing an unknown key", () => {
    const p = goodProfile();
    setCompute(p, 5, { sum: ["dc.pv1.power", "does.not.exist"] });
    expect(safeParseProfileData(p).success).toBe(false);
  });

  test("rejects computeExpr forward-referencing a later computed metric", () => {
    const p = goodProfile();
    // total (computed) references a computed metric declared after it
    p.metrics.push(
      metric("dc/derived", {
        label: "D",
        group: "inverter",
        computeExpr: { scale: ["dc.total_power", 2] },
      }),
    );
    setCompute(p, 5, { sum: ["dc.derived"] });
    expect(safeParseProfileData(p).success).toBe(false);
  });

  test("rejects unknown top-level keys (strict)", () => {
    const p = { ...goodProfile(), rogue: true };
    expect(safeParseProfileData(p).success).toBe(false);
  });

  test("accepts a valid clamp computeExpr", () => {
    const p = goodProfile();
    setCompute(p, 5, { clamp: { key: "dc.pv1.power", min: 0 } });
    expect(safeParseProfileData(p).success).toBe(true);
  });

  test("rejects a clamp with neither min nor max (no-op)", () => {
    const p = goodProfile();
    setCompute(p, 5, { clamp: { key: "dc.pv1.power" } });
    expect(safeParseProfileData(p).success).toBe(false);
  });

  test("rejects a clamp referencing an unknown key", () => {
    const p = goodProfile();
    setCompute(p, 5, { clamp: { key: "does.not.exist", min: 0 } });
    expect(safeParseProfileData(p).success).toBe(false);
  });
});

/**
 * Patch a metric's addressing the way an author re-deriving it would.
 *
 * After #76 the binding is the source of truth and `defineProfile` emits v2, so
 * moving only the legacy `type`/`addresses` mirror is invalid authoring — the
 * agreement check fires and masks whichever lint the test is actually about.
 * (Before that check was live, `rejects duplicate wire addresses` had started
 * passing for the wrong reason.)
 */
function setAddressing(
  p: ProfileData,
  i: number,
  over: { type?: RegisterType; addresses?: number[] },
): void {
  const m = p.metrics[i]!;
  const type = over.type ?? m.type;
  const addresses = over.addresses ?? m.addresses;
  m.type = type;
  m.addresses = addresses;
  m.binding = { via: "modbus", addr: addresses, type };
}

/**
 * Drop to the v1 wire shape: addressing lives only in `type`/`addresses`, so a
 * test can patch the mirror freely without the v2 agreement check weighing in.
 * Useful for the lints that are version-independent.
 */
function asV1(p: ProfileData): ProfileData {
  return {
    ...p,
    schemaVersion: 1,
    metrics: p.metrics.map(({ binding: _binding, ...rest }) => rest as (typeof p.metrics)[number]),
  };
}

/**
 * Set a metric's compute expression and its binding together — the same
 * re-derivation `setAddressing` does, for the compute arm.
 */
function setCompute(p: ProfileData, i: number, expr: unknown): void {
  const m = p.metrics[i]!;
  m.computeExpr = expr as never;
  m.binding = { via: "compute", expr: expr as never };
}

/** As {@link setCompute}, for the control arm. */
function setControl(p: ProfileData, i: number, expr: unknown): void {
  const m = p.metrics[i]!;
  m.controlExpr = expr as never;
  m.binding = { via: "control", expr: expr as never };
}

/** Every issue message the parse produced, so a rule is pinned to its wording. */
const issues = (p: unknown): string[] => {
  const r = safeParseProfileData(p);
  return r.success ? [] : r.error.issues.map((i) => i.message);
};

describe("profileDataSchema — register width", () => {
  test("a computed metric carrying addresses is rejected by name", () => {
    const p = goodProfile();
    setAddressing(p, 5, { addresses: [700] });
    expect(issues(p)).toContain("computed metric must have no addresses");
  });

  test("RAW needs at least one address", () => {
    const p = goodProfile();
    setAddressing(p, 2, { type: "RAW" });
    expect(issues(p)).toEqual([]);
    setAddressing(p, 2, { addresses: [] });
    expect(issues(p)).toContain("RAW metric needs at least one address");
  });

  test("RAW accepts an arbitrary word count", () => {
    const p = goodProfile();
    setAddressing(p, 2, { type: "RAW", addresses: [700, 701, 702] });
    expect(issues(p)).toEqual([]);
  });

  test("a single-word type reports the count it wanted and got", () => {
    const p = goodProfile();
    setAddressing(p, 2, { addresses: [700, 701] });
    expect(issues(p)).toContain("U_WORD needs 1 address(es), got 2");
  });

  test("U_DWORD wants exactly two addresses", () => {
    const p = goodProfile();
    setAddressing(p, 2, { type: "U_DWORD" });
    expect(issues(p)).toContain("U_DWORD needs 2 address(es), got 1");
    setAddressing(p, 2, { addresses: [700, 701] });
    expect(issues(p)).toEqual([]);
  });

  test("a control that is also computed and addressed reports both faults", () => {
    // Asserted at v1. The faults are version-independent, but a metric that is
    // simultaneously a control, computed AND addressed has no coherent binding
    // either — so at v2 the agreement check adds a third issue and this
    // assertion would stop being about the two faults it names.
    const p = asV1(controlProfile());
    p.metrics[1]!.computeExpr = { sum: ["settings.max_discharge"] };
    p.metrics[1]!.addresses = [200];
    expect(issues(p)).toEqual([
      "metric cannot be both a control and computed",
      "control metric must have no addresses",
    ]);
  });
});

/** A profile with a writable target + a composite control that toggles it. */
function controlProfile(): ProfileData {
  return defineProfile({
    id: "test-ctrl",
    name: "Test Control",
    manufacturer: "ACME",
    version: "1.0.0",
    metrics: [
      metric("settings/max_discharge", {
        label: "Max discharge",
        unit: "A",
        group: "settings",
        addr: 109,
        access: "rw",
      }),
      control<"settings.max_discharge">("settings/lock", {
        label: "Lock",
        group: "settings",
        enumLabels: { 0: "Unlocked", 1: "Locked" },
        controlExpr: { snapshotToggle: { target: "settings.max_discharge", lockedValue: 0 } },
      }),
    ],
  });
}

describe("control() builder", () => {
  test("is an addressless, writable metric carrying the controlExpr", () => {
    const c = control<"a.b">("settings/lock", {
      label: "Lock",
      group: "settings",
      controlExpr: { snapshotToggle: { target: "a.b", lockedValue: 0 } },
    });
    expect(c.key).toBe("settings.lock");
    expect(c.addresses).toEqual([]);
    expect(c.access).toBe("rw");
    expect(c.controlExpr).toEqual({ snapshotToggle: { target: "a.b", lockedValue: 0 } });
  });

  test("target is constrained to the profile key type", () => {
    control<"a.b">("settings/lock", {
      label: "Lock",
      group: "settings",
      // @ts-expect-error "nope" is not a member of the key union
      controlExpr: { snapshotToggle: { target: "nope", lockedValue: 0 } },
    });
  });
});

describe("profileDataSchema — controlExpr", () => {
  test("accepts a valid snapshotToggle control", () => {
    expect(safeParseProfileData(controlProfile()).success).toBe(true);
  });

  test("accepts a valid preset control", () => {
    const p = controlProfile();
    setControl(p, 1, {
      preset: { writes: [{ target: "settings.max_discharge", value: 5 }] },
    });
    expect(safeParseProfileData(p).success).toBe(true);
  });

  test("rejects a control targeting an unknown key", () => {
    const p = controlProfile();
    setControl(p, 1, { snapshotToggle: { target: "does.not.exist", lockedValue: 0 } });
    expect(safeParseProfileData(p).success).toBe(false);
  });

  test("rejects a control targeting a read-only metric", () => {
    const p = controlProfile();
    p.metrics[0]!.access = "r"; // target no longer writable
    expect(safeParseProfileData(p).success).toBe(false);
  });

  test("rejects a control targeting another control (no chaining)", () => {
    const p = controlProfile();
    p.metrics.push(
      control<"settings.lock">("settings/lock2", {
        label: "Lock2",
        group: "settings",
        controlExpr: { snapshotToggle: { target: "settings.lock", lockedValue: 0 } },
      }),
    );
    expect(safeParseProfileData(p).success).toBe(false);
  });

  test("rejects a control metric that carries addresses", () => {
    const p = controlProfile();
    setAddressing(p, 1, { addresses: [200] });
    expect(safeParseProfileData(p).success).toBe(false);
  });

  test("rejects a metric that is both a control and computed", () => {
    const p = controlProfile();
    setCompute(p, 1, { sum: ["settings.max_discharge"] });
    expect(safeParseProfileData(p).success).toBe(false);
  });
});

describe("hydrateProfile", () => {
  test("carries controlExpr through to the runtime metric def", () => {
    const profile = hydrateProfile(controlProfile());
    const lock = profile.metrics.find((m) => m.key === "settings.lock");
    expect(lock?.controlExpr).toEqual({
      snapshotToggle: { target: "settings.max_discharge", lockedValue: 0 },
    });
    expect(lock?.addresses).toEqual([]);
  });

  test("compiles computeExpr into a working compute closure", () => {
    const profile = hydrateProfile(goodProfile());
    const total = profile.metrics.find((m) => m.key === "dc.total_power");
    expect(total?.compute).toBeInstanceOf(Function);
    expect(total?.compute?.({ "dc.pv1.power": 100, "dc.pv2.power": 250 })).toBe(350);
  });

  test("carries an injected simulate hook and drops data-only fields", () => {
    const sim = () => ({});
    const profile = hydrateProfile(goodProfile(), { simulate: sim });
    expect(profile.simulate).toBe(sim);
    expect("schemaVersion" in profile).toBe(false);
    expect("version" in profile).toBe(false);
  });
});

describe("compileComputeExpr", () => {
  test("sum / diff / scale", () => {
    expect(compileComputeExpr({ sum: ["a", "b", "c"] })({ a: 1, b: 2, c: 3 })).toBe(6);
    expect(compileComputeExpr({ diff: ["a", "b"] })({ a: 10, b: 4 })).toBe(6);
    expect(compileComputeExpr({ scale: ["a", 0.1] })({ a: 50 })).toBe(5);
    expect(compileComputeExpr({ sum: ["a", "missing"] })({ a: 1 })).toBe(1);
  });

  test("combine sums adds minus subs, missing keys read as 0", () => {
    const f = compileComputeExpr({ combine: { add: ["a", "b"], sub: ["c"] } });
    expect(f({ a: 100, b: -40, c: 20 })).toBe(40);
    expect(compileComputeExpr({ combine: { add: ["a"] } })({ a: 7 })).toBe(7);
    expect(f({ a: 10 })).toBe(10);
  });

  test("ratio scales the num/den quotient, guarding a zero denominator", () => {
    const eff = compileComputeExpr({ ratio: { num: ["load"], den: ["a", "b"], scale: 100 } });
    expect(eff({ load: 900, a: 1000, b: 0 })).toBe(90);
    expect(eff({ load: 900, a: 0, b: 0 })).toBe(0);
    expect(compileComputeExpr({ ratio: { num: ["a"], den: ["b"] } })({ a: 3, b: 4 })).toBe(0.75);
  });

  test("clamp bounds a single key, missing key reads as 0", () => {
    // min-only = positive part max(0, x): clamps below, identity above.
    const pos = compileComputeExpr({ clamp: { key: "a", min: 0 } });
    expect(pos({ a: -30 })).toBe(0);
    expect(pos({ a: 42 })).toBe(42);
    expect(pos({})).toBe(0); // missing key → 0

    // max-only clamps above, identity below.
    const capped = compileComputeExpr({ clamp: { key: "a", max: 100 } });
    expect(capped({ a: 250 })).toBe(100);
    expect(capped({ a: 5 })).toBe(5);

    // both bounds.
    const both = compileComputeExpr({ clamp: { key: "a", min: 0, max: 100 } });
    expect(both({ a: -5 })).toBe(0);
    expect(both({ a: 150 })).toBe(100);
    expect(both({ a: 60 })).toBe(60);
  });
});

describe("profileDataSchema — storage and deadband", () => {
  /** The PV1 measurement of {@link goodProfile}, with storage fields applied. */
  function withStorage(patch: Partial<MetricDataDef>): ReturnType<typeof safeParseProfileData> {
    const p = goodProfile();
    Object.assign(p.metrics[0]!, patch);
    return safeParseProfileData(p);
  }

  test("a profile with no storage field parses, and every metric resolves to its default", () => {
    // The backwards-compatibility proof: the field is optional precisely so no
    // published profile has to be rebuilt to keep parsing.
    const parsed = safeParseProfileData(goodProfile());
    expect(parsed.success).toBe(true);
    const metrics = parsed.data!.metrics;
    expect(metrics.every((m) => m.storage === undefined)).toBe(true);
    expect(resolveStorage(metrics.find((m) => m.key === "settings.workmode")!)).toBe("config");
    expect(resolveStorage(metrics.find((m) => m.key === "dc.pv1.power")!)).toBe("series");
  });

  test("accepts each declared storage class", () => {
    for (const storage of ["series", "config", "none"] as const) {
      expect(withStorage({ storage }).success).toBe(true);
    }
  });

  test("an unknown storage value fails rather than silently defaulting", () => {
    expect(withStorage({ storage: "ephemeral" as MetricStorage }).success).toBe(false);
  });

  test("accepts a deadband in the metric's own unit, at and above the scale floor", () => {
    expect(withStorage({ deadband: 1 }).success).toBe(true);
    expect(withStorage({ scale: 0.1, deadband: 0.1 }).success).toBe(true);
  });

  test("deadband 0 fails validation — there is no zero threshold", () => {
    // `0` as a stand-in for "not applicable" makes it indistinguishable from a
    // real threshold of zero. Absence means no filtering; nothing else does.
    expect(withStorage({ deadband: 0 }).success).toBe(false);
  });

  test("a negative deadband fails validation", () => {
    expect(withStorage({ deadband: -1 }).success).toBe(false);
  });

  test("a deadband below the register's quantisation step fails validation", () => {
    // Unrepresentable, so it is an authoring error rather than a no-op.
    expect(withStorage({ scale: 0.1, deadband: 0.05 }).success).toBe(false);
  });

  test("a deadband on a counter or a status enum fails validation", () => {
    // Both are stored exactly: a threshold makes a counter lag, and on an enum
    // it can swallow a genuine state transition. Rejected at authoring time
    // rather than quietly ignored at write time.
    // Roleless: a mapped role's kind wins over the kWh unit, and this profile's
    // PV metric is role-mapped as a measurement.
    expect(
      withStorage({ role: undefined, index: undefined, unit: "kWh", deadband: 5 }).success,
    ).toBe(false);
    expect(withStorage({ kind: "status", deadband: 1 }).success).toBe(false);
  });

  test("a deadband on a metric that is not stored as a series fails validation", () => {
    expect(withStorage({ storage: "none", deadband: 1 }).success).toBe(false);
    expect(withStorage({ storage: "config", deadband: 1 }).success).toBe(false);
  });

  test("a deadband is accepted on a setting explicitly stored as a series", () => {
    // The awkward direction, and the reason storage is a field rather than a
    // derivation: `settings.battery.maximum_charge_current` is written by the
    // automation engine and worth charting.
    const p = goodProfile();
    Object.assign(p.metrics[4]!, { storage: "series", deadband: 1, kind: "measurement" });
    expect(safeParseProfileData(p).success).toBe(true);
  });

  test("the metric() builder carries storage and deadband through", () => {
    const built = metric("ac/l1/voltage", {
      label: "L1",
      unit: "V",
      group: "grid",
      addr: 598,
      scale: 0.1,
      storage: "series",
      deadband: 1,
    });
    expect(built.storage).toBe("series");
    expect(built.deadband).toBe(1);
  });

  test("the control() builder carries storage through", () => {
    const built = control("settings/battery/lock", {
      label: "Lock",
      group: "settings",
      controlExpr: { snapshotToggle: { target: "settings.workmode", lockedValue: 1 } },
      storage: "none",
    });
    expect(built.storage).toBe("none");
  });
});
