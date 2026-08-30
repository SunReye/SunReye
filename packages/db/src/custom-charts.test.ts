import { describe, expect, test } from "bun:test";

import {
  type CustomChartConfig,
  chartSeries,
  customChartConfigSchema,
  soleInverterSlug,
} from "./custom-charts";

/**
 * A saved chart on a multi-device plant.
 *
 * Until 2.0.0 a chart was a bare list of metric keys, which meant "whichever
 * device" — the EXACT ambiguity the retired `inverter_id` column had. With one
 * inverter that question still has an answer, so it is answered now: the default
 * is resolved on read, and the resolution is recorded when the operator states
 * one. Once a second inverter exists nobody can say what an old chart meant, and
 * no migration can go back and ask.
 */
const config = (over: Partial<CustomChartConfig> = {}): CustomChartConfig =>
  customChartConfigSchema.parse({ metrics: ["pv.power", "battery.soc"], ...over });

describe("an already-stored chart document", () => {
  test("keeps parsing, and gains nothing", () => {
    // The migration-free upgrade. Not `toMatchObject`: a `devices: {}` added here
    // would be a chart claiming to name devices, and the next writer would
    // persist that claim.
    const parsed = customChartConfigSchema.parse({ metrics: ["pv.power"] });
    expect(parsed).toEqual({ metrics: ["pv.power"] });
    expect(Object.keys(parsed)).toEqual(["metrics"]);
  });

  test("keeps parsing with its colours", () => {
    const stored = { metrics: ["pv.power", "battery.soc"], colors: { "pv.power": "chart-3" } };
    expect(customChartConfigSchema.parse(stored)).toEqual(stored);
  });

  test("renders against the plant's sole inverter", () => {
    // "Whichever device" resolved, rather than left as a hole for the read path
    // to fill differently each time.
    expect(chartSeries(config(), "deye-1")).toEqual([
      { metric: "pv.power", device: "deye-1" },
      { metric: "battery.soc", device: "deye-1" },
    ]);
  });

  test("resolves to no device when the plant cannot name one", () => {
    // Null, not the first inverter and not a throw: the chart is still perfectly
    // renderable from whatever the read path already did (it had no device to go
    // on before either), and inventing one would silently attribute a series to
    // hardware nobody chose.
    expect(chartSeries(config(), null)).toEqual([
      { metric: "pv.power", device: null },
      { metric: "battery.soc", device: null },
    ]);
  });
});

describe("a chart that names its devices", () => {
  test("prefers the stated slug over the plant default", () => {
    const stated = config({ devices: { "pv.power": "east-inv" } });
    expect(chartSeries(stated, "deye-1")).toEqual([
      { metric: "pv.power", device: "east-inv" },
      // Per SERIES, not per chart: the unstated one still defaults.
      { metric: "battery.soc", device: "deye-1" },
    ]);
  });

  test("keeps the stated slug even when the plant has no default", () => {
    expect(chartSeries(config({ devices: { "pv.power": "east-inv" } }), null)).toEqual([
      { metric: "pv.power", device: "east-inv" },
      { metric: "battery.soc", device: null },
    ]);
  });

  test("ignores an entry for a metric the chart no longer plots", () => {
    // Keyed by metric key, like `colors`, so a chart whose metrics were thinned
    // keeps the right slug on the right series — and the orphan is not a series.
    const stale = config({ metrics: ["pv.power"], devices: { "battery.soc": "east-inv" } });
    expect(chartSeries(stale, "deye-1")).toEqual([{ metric: "pv.power", device: "deye-1" }]);
  });

  test("names devices by SLUG, refusing anything that is not one", () => {
    // A slug is the API and export vocabulary (`devices.slug` in
    // `./schema/plants.ts`); the int2 is a storage detail a restore renumbers, so
    // it must never reach a saved document. `""` is refused for the same reason
    // the array's `deviceSlug` refuses it: it names nothing while reading as a
    // stated value.
    const bad = (devices: unknown) =>
      customChartConfigSchema.safeParse({ metrics: ["pv.power"], devices }).success;
    expect(bad({ "pv.power": "" })).toBe(false);
    expect(bad({ "pv.power": 3 })).toBe(false);
    expect(bad({ "": "deye-1" })).toBe(false);
    expect(bad({ "pv.power": "deye-1" })).toBe(true);
  });

  test("still refuses a chart with no metrics at all", () => {
    // The device map is not a series list: naming devices for nothing is not a
    // chart, and the existing floor stays where it was.
    expect(
      customChartConfigSchema.safeParse({ metrics: [], devices: { "pv.power": "deye-1" } }).success,
    ).toBe(false);
  });
});

describe("the plant's default chart device", () => {
  const device = (over: object = {}) => ({
    slug: "deye-1",
    role: "inverter",
    retiredAt: null,
    ...over,
  });

  test("is the sole inverter's slug", () => {
    expect(soleInverterSlug([device()])).toBe("deye-1");
  });

  test("is null once there are two, because the question has no answer", () => {
    // The whole reason this release records the slug: with two inverters an
    // unqualified chart is ambiguous, and guessing "the first one" would attach
    // years of saved charts to whichever row happened to sort lowest.
    expect(soleInverterSlug([device(), device({ slug: "deye-2" })])).toBeNull();
  });

  test("is null on a plant with no inverter at all", () => {
    // Reachable: an onboarding-only boot, or a plant of meters and chargers.
    expect(soleInverterSlug([])).toBeNull();
    expect(soleInverterSlug([device({ role: "meter" }), device({ role: "charger" })])).toBeNull();
  });

  test("ignores devices that are not inverters", () => {
    // A meter reports plant-level values from its own registers; it is not what a
    // PV or battery series is read from.
    expect(soleInverterSlug([device({ slug: "sdm630", role: "meter" }), device()])).toBe("deye-1");
  });

  test("ignores an OPTIMIZER — a virtual device has no series to read", () => {
    // The optimizer writes decisions, not measurements: it has no registers, so
    // an unqualified PV or battery series can never mean it. Left in, a plant
    // with one inverter and one optimizer would look like "two devices" to a
    // count-based rule and drop every new chart's device to null.
    expect(soleInverterSlug([device({ slug: "optimizer", role: "optimizer" }), device()])).toBe(
      "deye-1",
    );
    expect(soleInverterSlug([device({ slug: "optimizer", role: "optimizer" })])).toBeNull();
  });

  test("ignores a RETIRED inverter", () => {
    // Retirement is about the future: the old inverter's history stays readable,
    // but a chart saved today means the machine that is running. A replaced
    // inverter would otherwise make the plant permanently "ambiguous" and drop
    // every new chart's device to null.
    expect(soleInverterSlug([device({ slug: "old-deye", retiredAt: new Date() }), device()])).toBe(
      "deye-1",
    );
    // A future date retires it NOW — the same rule `isRetired` states, not a
    // second spelling of it.
    expect(
      soleInverterSlug([device({ slug: "old-deye", retiredAt: new Date("2099-01-01") }), device()]),
    ).toBe("deye-1");
  });

  test("is null when the only inverter is retired", () => {
    expect(soleInverterSlug([device({ retiredAt: new Date() })])).toBeNull();
  });
});

describe("chartSeries edge cases", () => {
  test("a metric plotted twice yields two series, both resolved the same way", () => {
    // Nothing enforces unique metric keys, and the shape is keyed by metric key —
    // so one metric on two devices is NOT expressible yet, and this pins that
    // honestly rather than pretending otherwise. Making it expressible turns
    // `metrics` into a list of entries, which is the next migration-free step and
    // is only worth taking when a second device exists to want it.
    const twice = config({
      metrics: ["pv.power", "pv.power"],
      devices: { "pv.power": "east-inv" },
    });
    expect(chartSeries(twice, "deye-1")).toEqual([
      { metric: "pv.power", device: "east-inv" },
      { metric: "pv.power", device: "east-inv" },
    ]);
  });

  test("leaves the config untouched", () => {
    // A resolver, not a normaliser: the caller writes this config back on the
    // next save, and a resolved default persisted into the document would freeze
    // today's guess as tomorrow's stated fact.
    const stored = config();
    chartSeries(stored, "deye-1");
    expect(stored).toEqual({ metrics: ["pv.power", "battery.soc"] });
  });
});
