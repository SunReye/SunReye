import { beforeEach, describe, expect, test } from "bun:test";

import {
  buildManifest,
  deriveCapabilities,
  kindFallbackKeys,
  kindFallbackReports,
  resetKindFallbacks,
  resolveDeadband,
  resolveKind,
  resolveStorage,
  toManifestMetric,
} from "./capabilities";
import type { CanonicalRole, InverterProfile, MetricDef } from "./types";

/**
 * Minimal {@link MetricDef} builder — every wire field defaulted so a test can
 * name only the fields it exercises (role, access, group, unit, kind, index).
 */
function m({
  type = "U_WORD",
  addresses = [0],
  ...overrides
}: Partial<MetricDef> & { key: string }): MetricDef {
  return {
    topic: overrides.key.replaceAll(".", "/"),
    label: overrides.key,
    unit: null,
    group: "misc",
    type,
    addresses,
    // The legacy mirror stays in step with the binding, exactly as
    // `hydrateProfile` keeps it.
    binding: { via: "modbus", addr: addresses, type },
    scale: 1,
    access: "r",
    ...overrides,
  } as MetricDef;
}

function profile(metrics: MetricDef[]): InverterProfile {
  return { id: "test", name: "Test", manufacturer: "ACME", metrics };
}

describe("resolveKind", () => {
  test("an explicit kind wins over every inference", () => {
    expect(resolveKind(m({ key: "x", kind: "status", access: "rw", unit: "kWh" }))).toBe("status");
  });

  test("a writable metric with no explicit kind infers setting", () => {
    expect(resolveKind(m({ key: "x", access: "rw" }))).toBe("setting");
  });

  test("a read-only kWh metric infers cumulative", () => {
    expect(resolveKind(m({ key: "x", access: "r", unit: "kWh" }))).toBe("cumulative");
  });

  test("a role-mapped metric with no explicit kind inherits its role's kind", () => {
    // The Deye `ac.relay_status` shape: read-only, unitless, kind-less — but the
    // role catalog already knows it is a status enum.
    expect(resolveKind(m({ key: "ac.relay_status", role: "inverter.relay_status" }))).toBe(
      "status",
    );
    expect(resolveKind(m({ key: "e", role: "production.today" }))).toBe("cumulative");
  });

  test("everything else defaults to measurement", () => {
    expect(resolveKind(m({ key: "x", access: "r", unit: "W" }))).toBe("measurement");
    expect(resolveKind(m({ key: "x", access: "r", unit: null }))).toBe("measurement");
  });
});

describe("the resolveKind fallback", () => {
  beforeEach(() => resetKindFallbacks());

  // Asserted against the ledger rather than the log transport: the observable
  // fact is "one entry per key, counting every occurrence", and a test that
  // spies on the logger breaks the moment the logger changes without the
  // behaviour changing. Same shape as codec's clampReports().
  test("is recorded once per key, however many times it resolves", () => {
    const def = m({ key: "ac.mystery", access: "r", unit: null });
    resolveKind(def);
    resolveKind(def);
    resolveKind(def);
    expect(kindFallbackKeys()).toEqual(["ac.mystery"]);
    expect(kindFallbackReports()).toEqual([{ key: "ac.mystery", count: 3 }]);
  });

  test("counts separate keys separately", () => {
    resolveKind(m({ key: "ac.mystery", access: "r", unit: null }));
    resolveKind(m({ key: "ac.other", access: "r", unit: null }));
    resolveKind(m({ key: "ac.mystery", access: "r", unit: null }));
    expect(kindFallbackReports()).toEqual([
      { key: "ac.mystery", count: 2 },
      { key: "ac.other", count: 1 },
    ]);
  });

  test("records nothing when the kind is explicit, role-mapped, writable or kWh", () => {
    resolveKind(m({ key: "a", kind: "status" }));
    resolveKind(m({ key: "b", role: "inverter.relay_status" }));
    resolveKind(m({ key: "c", access: "rw" }));
    resolveKind(m({ key: "d", unit: "kWh" }));
    expect(kindFallbackKeys()).toEqual([]);
    expect(kindFallbackReports()).toEqual([]);
  });
});

describe("toManifestMetric", () => {
  test("projects the render-ready fields and drops functions/addresses", () => {
    const def = m({
      key: "battery.soc",
      topic: "battery/soc",
      label: "Battery SOC",
      unit: "%",
      group: "battery",
      access: "r",
      role: "battery.soc",
      index: 1,
      range: { min: 0, max: 100 },
      enumLabels: { 0: "off", 1: "on" },
      flow: { positive: "charge", negative: "discharge" },
      addresses: [588],
      compute: () => 1,
    });

    expect(toManifestMetric(def)).toEqual({
      key: "battery.soc",
      topic: "battery/soc",
      label: "Battery SOC",
      unit: "%",
      group: "battery",
      kind: "measurement",
      storage: "series",
      writable: false,
      role: "battery.soc",
      index: 1,
      range: { min: 0, max: 100 },
      enumLabels: { 0: "off", 1: "on" },
      flow: { positive: "charge", negative: "discharge" },
    });
  });

  test("writable follows access:rw and kind is inferred", () => {
    const out = toManifestMetric(m({ key: "setting.work_mode", access: "rw" }));
    expect(out.writable).toBe(true);
    expect(out.kind).toBe("setting");
  });

  test("optional metadata is carried through as undefined when absent", () => {
    const out = toManifestMetric(m({ key: "plain", access: "r" }));
    expect(out.role).toBeUndefined();
    expect(out.index).toBeUndefined();
    expect(out.range).toBeUndefined();
    expect(out.enumLabels).toBeUndefined();
    expect(out.flow).toBeUndefined();
  });
});

describe("deriveCapabilities — subsystem presence", () => {
  test("battery is true when any battery.* role is present", () => {
    expect(deriveCapabilities(profile([m({ key: "b", role: "battery.soc" })])).battery).toBe(true);
  });

  test("grid is true when any grid.* role is present", () => {
    expect(deriveCapabilities(profile([m({ key: "g", role: "grid.power" })])).grid).toBe(true);
  });

  test("generator is true when any generator.* role is present", () => {
    expect(
      deriveCapabilities(profile([m({ key: "gen", role: "generator.power" })])).generator,
    ).toBe(true);
  });

  test("backupLoad is true when any backup.* role is present", () => {
    expect(deriveCapabilities(profile([m({ key: "b", role: "backup.power" })])).backupLoad).toBe(
      true,
    );
  });

  test("a house-load role alone never claims a backup output", () => {
    // The grid-tied case: `load.power` is a consumption meter, not a UPS. The
    // output is a declaration, not an inference — see `ProfileDeclarations`.
    expect(deriveCapabilities(profile([m({ key: "l", role: "load.power" })])).backupLoad).toBe(
      false,
    );
  });

  test("a declared backup output needs no metric behind it", () => {
    expect(
      deriveCapabilities({ ...profile([]), declares: { backupOutput: true } }).backupLoad,
    ).toBe(true);
  });

  test("subsystems are all false for a profile with no matching roles", () => {
    const caps = deriveCapabilities(profile([m({ key: "s", role: "inverter.status" })]));
    expect(caps.battery).toBe(false);
    expect(caps.grid).toBe(false);
    expect(caps.generator).toBe(false);
    expect(caps.backupLoad).toBe(false);
  });

  test("a metric without any role never flips a subsystem on", () => {
    const caps = deriveCapabilities(profile([m({ key: "n" })]));
    expect(caps.battery).toBe(false);
    expect(caps.grid).toBe(false);
    expect(caps.generator).toBe(false);
    expect(caps.backupLoad).toBe(false);
  });

  test("a role outside ROLE_CATALOG is tolerated and matches no subsystem prefix", () => {
    // startsWith over an unknown string must not throw and must not flip flags.
    const rogue = m({ key: "r", role: "totally.unknown" as CanonicalRole });
    const caps = deriveCapabilities(profile([rogue]));
    expect(caps.battery).toBe(false);
    expect(caps.grid).toBe(false);
    expect(caps.generator).toBe(false);
    expect(caps.backupLoad).toBe(false);
  });
});

describe("deriveCapabilities — pvStrings", () => {
  test("counts distinct pv.string.power indices", () => {
    const caps = deriveCapabilities(
      profile([
        m({ key: "pv1", role: "pv.string.power", index: 1 }),
        m({ key: "pv2", role: "pv.string.power", index: 2 }),
      ]),
    );
    expect(caps.pvStrings).toBe(2);
  });

  test("de-duplicates repeated indices (power+voltage of the same string count once)", () => {
    const caps = deriveCapabilities(
      profile([
        m({ key: "pv1p", role: "pv.string.power", index: 1 }),
        m({ key: "pv1v", role: "pv.string.voltage", index: 1 }),
        m({ key: "pv1p2", role: "pv.string.power", index: 1 }),
      ]),
    );
    expect(caps.pvStrings).toBe(1);
  });

  test("counts distinct indices even with a gap (1 and 3 → 2 strings)", () => {
    const caps = deriveCapabilities(
      profile([
        m({ key: "pv1", role: "pv.string.power", index: 1 }),
        m({ key: "pv3", role: "pv.string.power", index: 3 }),
      ]),
    );
    expect(caps.pvStrings).toBe(2);
  });

  test("ignores a pv.string.power metric that carries no index", () => {
    const caps = deriveCapabilities(profile([m({ key: "pv", role: "pv.string.power" })]));
    expect(caps.pvStrings).toBe(0);
  });

  test("is zero when no pv strings are present", () => {
    expect(deriveCapabilities(profile([m({ key: "x", role: "grid.power" })])).pvStrings).toBe(0);
  });
});

describe("deriveCapabilities — phases", () => {
  test("counts distinct grid.phase.voltage indices", () => {
    const caps = deriveCapabilities(
      profile([
        m({ key: "l1", role: "grid.phase.voltage", index: 1 }),
        m({ key: "l2", role: "grid.phase.voltage", index: 2 }),
        m({ key: "l3", role: "grid.phase.voltage", index: 3 }),
      ]),
    );
    expect(caps.phases).toBe(3);
  });

  test("floors at 1 even when no grid.phase.voltage metric exists", () => {
    expect(deriveCapabilities(profile([m({ key: "x", role: "battery.soc" })])).phases).toBe(1);
  });

  test("floors at 1 for a single measured phase", () => {
    expect(
      deriveCapabilities(profile([m({ key: "l1", role: "grid.phase.voltage", index: 1 })])).phases,
    ).toBe(1);
  });
});

describe("deriveCapabilities — features", () => {
  test("solar_sell is added when setting.solar_sell.enabled is present", () => {
    const caps = deriveCapabilities(
      profile([m({ key: "ss", role: "setting.solar_sell.enabled", access: "rw" })]),
    );
    expect(caps.features).toEqual(["solar_sell"]);
  });

  test("grid_charge is added when setting.battery.grid_charge is present", () => {
    const caps = deriveCapabilities(
      profile([m({ key: "gc", role: "setting.battery.grid_charge", access: "rw" })]),
    );
    expect(caps.features).toEqual(["grid_charge"]);
  });

  test("time_of_use is added when any metric is in the timeofuse group", () => {
    const caps = deriveCapabilities(profile([m({ key: "tou", group: "timeofuse", access: "rw" })]));
    expect(caps.features).toEqual(["time_of_use"]);
  });

  test("features preserve solar_sell, grid_charge, time_of_use order", () => {
    const caps = deriveCapabilities(
      profile([
        m({ key: "tou", group: "timeofuse", access: "rw" }),
        m({ key: "gc", role: "setting.battery.grid_charge", access: "rw" }),
        m({ key: "ss", role: "setting.solar_sell.enabled", access: "rw" }),
      ]),
    );
    expect(caps.features).toEqual(["solar_sell", "grid_charge", "time_of_use"]);
  });

  test("features is empty when no feature signal is present", () => {
    expect(deriveCapabilities(profile([m({ key: "b", role: "battery.soc" })])).features).toEqual(
      [],
    );
  });
});

describe("deriveCapabilities — controls", () => {
  test("lists the keys of every writable metric, in order", () => {
    const caps = deriveCapabilities(
      profile([
        m({ key: "ro", access: "r" }),
        m({ key: "w1", access: "rw" }),
        m({ key: "w2", access: "rw" }),
      ]),
    );
    expect(caps.controls).toEqual(["w1", "w2"]);
  });

  test("is empty when nothing is writable", () => {
    expect(deriveCapabilities(profile([m({ key: "ro", access: "r" })])).controls).toEqual([]);
  });
});

describe("deriveCapabilities — boundaries", () => {
  test("a zero-metric profile yields all-off capabilities with phases floored at 1", () => {
    expect(deriveCapabilities(profile([]))).toEqual({
      battery: false,
      pvStrings: 0,
      phases: 1,
      grid: false,
      generator: false,
      backupLoad: false,
      features: [],
      controls: [],
    });
  });
});

describe("buildManifest", () => {
  test("assembles identity, derived capabilities, and the metric catalog", () => {
    const p = profile([
      m({ key: "battery.soc", role: "battery.soc", access: "r" }),
      m({ key: "pv1", role: "pv.string.power", index: 1, access: "r" }),
      m({ key: "setting.work_mode", access: "rw" }),
    ]);
    const manifest = buildManifest(p);

    expect(manifest.id).toBe("test");
    expect(manifest.name).toBe("Test");
    expect(manifest.manufacturer).toBe("ACME");
    expect(manifest.capabilities.battery).toBe(true);
    expect(manifest.capabilities.pvStrings).toBe(1);
    expect(manifest.capabilities.controls).toEqual(["setting.work_mode"]);
    expect(manifest.metrics).toHaveLength(3);
    expect(manifest.metrics.map((mm) => mm.key)).toEqual([
      "battery.soc",
      "pv1",
      "setting.work_mode",
    ]);
  });
});

describe("resolveStorage", () => {
  test("a setting derives the config change-log, not the hypertable", () => {
    // 34% of all rows written today are configuration registers persisted to a
    // timeseries table every poll; this derivation is what routes them out.
    expect(resolveStorage(m({ key: "settings.workmode", access: "rw" }))).toBe("config");
  });

  test("a measurement, a counter and a status enum all derive series", () => {
    expect(resolveStorage(m({ key: "ac.l1.voltage", unit: "V" }))).toBe("series");
    expect(resolveStorage(m({ key: "ac.daily_energy", unit: "kWh" }))).toBe("series");
    expect(resolveStorage(m({ key: "ac.relay_status", kind: "status" }))).toBe("series");
  });

  test("an explicit storage overrides the derivation, including the awkward direction", () => {
    // `settings.battery.maximum_charge_current` is written by the automation
    // engine, and charting it against battery power is genuinely useful — the
    // derivation would banish it to a change-log.
    expect(
      resolveStorage(
        m({ key: "settings.battery.maximum_charge_current", access: "rw", storage: "series" }),
      ),
    ).toBe("series");
    expect(resolveStorage(m({ key: "ac.l1.voltage", unit: "V", storage: "none" }))).toBe("none");
  });

  test("storage none is honoured on a role-mapped metric — a role does not force persistence", () => {
    expect(
      resolveStorage(
        m({ key: "ac.l1.voltage", role: "grid.phase.voltage", index: 1, storage: "none" }),
      ),
    ).toBe("none");
  });

  test("resolving storage never reports a kind fallback — it is not a kind question", () => {
    resetKindFallbacks();
    expect(resolveStorage(m({ key: "ac.relay_status" }))).toBe("series");
    expect(kindFallbackKeys()).toEqual([]);
  });
});

describe("resolveDeadband", () => {
  test("an authored deadband on a measurement is returned in the metric's own unit", () => {
    expect(resolveDeadband(m({ key: "ac.l1.voltage", unit: "V", scale: 0.1, deadband: 1 }))).toBe(
      1,
    );
  });

  test("absent by default — a wrong global threshold silently degrades data", () => {
    expect(resolveDeadband(m({ key: "ac.l1.voltage", unit: "V" }))).toBeUndefined();
  });

  test("undefined for a counter and a status enum, so a caller stores every change", () => {
    // Asserted as `undefined` rather than 0: a caller that coerced absence to a
    // zero threshold would pass a weaker test, and a deadband on a counter makes
    // it lag while one on an enum can swallow a state transition.
    expect(
      resolveDeadband(m({ key: "ac.total_energy", unit: "kWh", deadband: 5 })),
    ).toBeUndefined();
    expect(
      resolveDeadband(m({ key: "ac.relay_status", kind: "status", deadband: 1 })),
    ).toBeUndefined();
  });

  test("undefined when the metric is not stored as a series at all", () => {
    expect(
      resolveDeadband(m({ key: "settings.solar_sell", access: "rw", deadband: 2 })),
    ).toBeUndefined();
    expect(
      resolveDeadband(m({ key: "ac.l1.voltage", unit: "V", storage: "none", deadband: 2 })),
    ).toBeUndefined();
  });
});

describe("toManifestMetric", () => {
  test("carries the resolved storage class so the UI can hide unstored metrics", () => {
    expect(toManifestMetric(m({ key: "settings.workmode", access: "rw" })).storage).toBe("config");
    expect(toManifestMetric(m({ key: "ac.l1.voltage", unit: "V" })).storage).toBe("series");
  });
});
