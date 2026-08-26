import { describe, expect, test } from "bun:test";

import {
  defineProfile,
  metric,
  type MetricDataDef,
  type ProfileData,
} from "@SunReye/inverter-core";

import { LINT_RULES, semanticLints, type LintRule } from "./lints";
import { lintProfile } from "./validate";

const profile = (metrics: MetricDataDef[]): ProfileData =>
  defineProfile({ id: "acme", name: "Acme", manufacturer: "Acme", version: "1.0.0", metrics });

/** The rules that fired, deduped, in the order the linter reported them. */
const rules = (data: ProfileData): LintRule[] => [
  ...new Set(semanticLints(data).map((f) => f.rule)),
];

const keysFor = (data: ProfileData, rule: LintRule): string[] =>
  semanticLints(data)
    .filter((f) => f.rule === rule)
    .map((f) => f.key);

/**
 * A profile that is physically plausible in every way the lints check: a ranged
 * percentage, an unsigned lifetime counter, a properly offset temperature, a
 * gapless status enum and no zero scales. Every "does not fire" assertion is
 * built from this so a false positive shows up as a failing test.
 */
const cleanMetrics: MetricDataDef[] = [
  metric("battery/soc", {
    label: "Battery SOC",
    group: "battery",
    unit: "%",
    role: "battery.soc",
    addr: 588,
    range: { min: 0, max: 100 },
  }),
  metric("inverter/total_production", {
    label: "Total Production",
    group: "inverter",
    unit: "kWh",
    role: "production.total",
    type: "U_DWORD",
    addr: [534, 535],
    scale: 0.1,
    range: { min: 0, max: 1_000_000 },
  }),
  metric("inverter/temperature_dc", {
    label: "DC Temperature",
    group: "inverter",
    unit: "°C",
    role: "inverter.temperature.dc",
    addr: 90,
    scale: 0.1,
    offset: -100,
  }),
  metric("inverter/status", {
    label: "Status",
    group: "inverter",
    role: "inverter.status",
    addr: 59,
    enumLabels: { 0: "Standby", 1: "Selftest", 2: "Normal", 3: "Alarm" },
  }),
];

describe("semanticLints — the clean profile", () => {
  test("a physically plausible profile produces no findings at all", () => {
    expect(semanticLints(profile(cleanMetrics))).toEqual([]);
  });

  test("an empty profile produces no findings", () => {
    expect(semanticLints(profile([]))).toEqual([]);
  });

  test("every declared rule is reachable — a rule that can never fire is dead", () => {
    // One deliberately broken metric per rule; the linter must report all six.
    const broken = profile([
      metric("a/percent", { label: "A", group: "g", unit: "%", addr: 1 }),
      metric("b/energy", { label: "B", group: "g", unit: "kWh", type: "S_WORD", addr: 2 }),
      metric("c/counter", {
        label: "C",
        group: "g",
        unit: "kWh",
        type: "U_DWORD",
        addr: [3, 4],
        kind: "cumulative",
        range: { min: -5, max: 10 },
      }),
      metric("d/temp", { label: "D", group: "g", unit: "°C", addr: 5, scale: 0.1 }),
      metric("e/status", {
        label: "E",
        group: "g",
        addr: 6,
        kind: "status",
        enumLabels: { 0: "Off", 2: "On" },
      }),
      metric("f/zero", { label: "F", group: "g", unit: "W", addr: 7, scale: 0 }),
    ]);
    expect(new Set(semanticLints(broken).map((f) => f.rule))).toEqual(new Set(LINT_RULES));
  });
});

describe("percent-without-range", () => {
  test("fires on a percentage metric with no range, naming the key", () => {
    const data = profile([
      metric("timeofuse/soc/1", {
        label: "TOU SOC 1",
        group: "settings",
        unit: "%",
        access: "rw",
        addr: 268,
      }),
    ]);
    expect(rules(data)).toEqual(["percent-without-range"]);
    const [finding] = semanticLints(data);
    expect(finding?.key).toBe("timeofuse.soc.1");
    expect(finding?.message).toContain("range");
    expect(finding?.message).toContain("%");
  });

  test("fires on a gauge-shaped role with no range even when the unit is absent", () => {
    // `battery.soc` has a `%` unitHint in the role catalog: the gauge cannot
    // scale without bounds however the author spelled the unit.
    const data = profile([
      metric("battery/soc", {
        label: "SOC",
        group: "battery",
        role: "battery.soc",
        addr: 588,
      }),
    ]);
    expect(keysFor(data, "percent-without-range")).toEqual(["battery.soc"]);
  });

  test("does not fire when a range is present", () => {
    expect(rules(profile(cleanMetrics))).not.toContain("percent-without-range");
  });

  test("does not fire for a non-percentage unit without a range", () => {
    const data = profile([
      metric("ac/active_power", { label: "AC Power", group: "inverter", unit: "W", addr: 175 }),
    ]);
    expect(rules(data)).toEqual([]);
  });
});

describe("signed-lifetime-counter", () => {
  test("fires on a kWh metric stored in an S_WORD, naming key and type", () => {
    const data = profile([
      metric("inverter/total_production", {
        label: "Total Production",
        group: "inverter",
        unit: "kWh",
        type: "S_WORD",
        addr: 534,
        scale: 0.1,
        range: { min: 0, max: 6553 },
      }),
    ]);
    expect(keysFor(data, "signed-lifetime-counter")).toEqual(["inverter.total_production"]);
    expect(semanticLints(data)[0]?.message).toContain("S_WORD");
  });

  test("does not fire on a kWh metric in an unsigned register", () => {
    expect(rules(profile(cleanMetrics))).not.toContain("signed-lifetime-counter");
  });

  test("does not fire on a signed register holding a signed quantity", () => {
    const data = profile([
      metric("battery/power", {
        label: "Battery Power",
        group: "battery",
        unit: "W",
        type: "S_WORD",
        role: "battery.power",
        addr: 590,
        flow: { positive: "Charging", negative: "Discharging" },
      }),
    ]);
    expect(rules(data)).toEqual([]);
  });
});

describe("cumulative-negative-range", () => {
  test("fires when a cumulative metric allows a negative value", () => {
    const data = profile([
      metric("inverter/total_production", {
        label: "Total Production",
        group: "inverter",
        unit: "kWh",
        type: "U_DWORD",
        addr: [534, 535],
        kind: "cumulative",
        range: { min: -100, max: 1000 },
      }),
    ]);
    expect(keysFor(data, "cumulative-negative-range")).toEqual(["inverter.total_production"]);
    expect(semanticLints(data)[0]?.message).toContain("-100");
  });

  test("fires for a cumulative kind implied by the unit, not only an explicit one", () => {
    // No `kind` field: a read-only kWh metric resolves to `cumulative`.
    const data = profile([
      metric("grid/imported_total", {
        label: "Imported",
        group: "grid",
        unit: "kWh",
        type: "U_DWORD",
        addr: [522, 523],
        range: { min: -1, max: 1000 },
      }),
    ]);
    expect(keysFor(data, "cumulative-negative-range")).toEqual(["grid.imported_total"]);
  });

  test("does not fire on a range that starts at zero", () => {
    expect(rules(profile(cleanMetrics))).not.toContain("cumulative-negative-range");
  });

  test("does not fire on a negative range for a non-cumulative metric", () => {
    const data = profile([
      metric("battery/power", {
        label: "Battery Power",
        group: "battery",
        unit: "W",
        type: "S_WORD",
        role: "battery.power",
        addr: 590,
        range: { min: -12000, max: 12000 },
        flow: { positive: "Charging", negative: "Discharging" },
      }),
    ]);
    expect(rules(data)).toEqual([]);
  });
});

describe("temperature-missing-offset", () => {
  test("fires on a 0.1-scaled temperature with no offset, mentioning the +1000 encoding", () => {
    const data = profile([
      metric("inverter/temperature_ac", {
        label: "AC Temperature",
        group: "inverter",
        unit: "°C",
        role: "inverter.temperature.ac",
        addr: 91,
        scale: 0.1,
      }),
    ]);
    expect(keysFor(data, "temperature-missing-offset")).toEqual(["inverter.temperature_ac"]);
    expect(semanticLints(data)[0]?.message).toContain("offset");
    expect(semanticLints(data)[0]?.message).toContain("1000");
  });

  test("does not fire once the offset is declared", () => {
    expect(rules(profile(cleanMetrics))).not.toContain("temperature-missing-offset");
  });

  test("does not fire when the offset is explicitly zero", () => {
    // An author who wrote `offset: 0` has made the decision — that is not a miss.
    const data = profile([
      metric("battery/temperature", {
        label: "Battery Temperature",
        group: "battery",
        unit: "°C",
        role: "battery.temperature",
        addr: 586,
        scale: 0.1,
        offset: 0,
      }),
    ]);
    expect(rules(data)).toEqual([]);
  });

  test("does not fire for a temperature at a different scale", () => {
    const data = profile([
      metric("battery/temperature", {
        label: "Battery Temperature",
        group: "battery",
        unit: "°C",
        role: "battery.temperature",
        addr: 586,
        scale: 1,
      }),
    ]);
    expect(rules(data)).toEqual([]);
  });
});

describe("enum-labels-gap", () => {
  test("fires when a status enum skips a value inside its own numeric range", () => {
    const data = profile([
      metric("inverter/status", {
        label: "Status",
        group: "inverter",
        role: "inverter.status",
        addr: 59,
        enumLabels: { 0: "Standby", 1: "Selftest", 3: "Alarm" },
      }),
    ]);
    expect(keysFor(data, "enum-labels-gap")).toEqual(["inverter.status"]);
    // The message must name the value that has no label, or it is unactionable.
    expect(semanticLints(data)[0]?.message).toContain("2");
  });

  test("names every gap when several values are unlabelled", () => {
    const data = profile([
      metric("inverter/status", {
        label: "Status",
        group: "inverter",
        role: "inverter.status",
        addr: 59,
        enumLabels: { 0: "Standby", 4: "Alarm" },
      }),
    ]);
    const message = semanticLints(data)[0]?.message ?? "";
    for (const missing of ["1", "2", "3"]) expect(message).toContain(missing);
  });

  test("does not fire on a contiguous enum", () => {
    expect(rules(profile(cleanMetrics))).not.toContain("enum-labels-gap");
  });

  test("does not fire on a single-value or non-contiguous-by-design bitfield", () => {
    // One label cannot have a gap; nothing to report.
    const data = profile([
      metric("inverter/relay_status", {
        label: "Relays",
        group: "inverter",
        role: "inverter.relay_status",
        addr: 552,
        enumLabels: { 0: "Open" },
      }),
    ]);
    expect(rules(data)).toEqual([]);
  });
});

describe("zero-scale", () => {
  test("fires on scale: 0, which silently zeroes every reading", () => {
    const data = profile([
      metric("ac/active_power", {
        label: "AC Power",
        group: "inverter",
        unit: "W",
        addr: 175,
        scale: 0,
      }),
    ]);
    expect(keysFor(data, "zero-scale")).toEqual(["ac.active_power"]);
    expect(semanticLints(data)[0]?.message).toContain("0");
  });

  test("does not fire on a negative scale, which is a legitimate sign flip", () => {
    const data = profile([
      metric("grid/power", {
        label: "Grid Power",
        group: "grid",
        unit: "W",
        type: "S_WORD",
        role: "grid.power",
        addr: 169,
        scale: -1,
        flow: { positive: "Import", negative: "Export" },
      }),
    ]);
    expect(rules(data)).toEqual([]);
  });

  test("does not fire on any scale in the clean profile", () => {
    expect(rules(profile(cleanMetrics))).not.toContain("zero-scale");
  });
});

describe("semanticLints — several problems at once", () => {
  test("reports one finding per (metric, rule) pair and keeps metric order", () => {
    const data = profile([
      metric("a/percent", { label: "A", group: "g", unit: "%", addr: 1 }),
      metric("b/temp", { label: "B", group: "g", unit: "°C", addr: 2, scale: 0.1 }),
      metric("c/both", { label: "C", group: "g", unit: "%", addr: 3, scale: 0 }),
    ]);
    expect(semanticLints(data).map((f) => `${f.key}/${f.rule}`)).toEqual([
      "a.percent/percent-without-range",
      "b.temp/temperature-missing-offset",
      "c.both/percent-without-range",
      "c.both/zero-scale",
    ]);
  });
});

describe("lintProfile — storage resolution", () => {
  /** Read-only, unitless, roleless, kind-less: the shape that guesses. */
  const guessing = (extra: Partial<MetricDataDef> = {}): ProfileData =>
    profile([
      { ...metric("ac/relay_status", { label: "Relays", group: "inverter", addr: 552 }), ...extra },
    ]);

  test("an unresolvable kind warns that the storage class is a guess too", () => {
    // The kind guess stopped being cosmetic when it became the storage-policy
    // input: `measurement` means change-only *plus a deadband*, and a deadband on
    // a status enum can swallow a state transition.
    const [warning] = lintProfile(guessing());
    expect(warning).toContain("ac.relay_status");
    expect(warning).toContain("storage");
  });

  test("an explicit storage takes the storage consequence out of the kind warning", () => {
    // The kind is still a guess — it still drives widget choice — but nothing is
    // being guessed about persistence any more, so the warning must not say so.
    const [warning] = lintProfile(guessing({ storage: "series" }));
    expect(warning).toContain("ac.relay_status");
    expect(warning).not.toContain("storage");
  });

  test("a metric whose kind comes from a mapped role warns about neither", () => {
    expect(
      lintProfile(
        profile([
          metric("battery/soc", {
            label: "SOC",
            group: "battery",
            unit: "%",
            role: "battery.soc",
            addr: 588,
            range: { min: 0, max: 100 },
          }),
        ]),
      ),
    ).toEqual([]);
  });
});
