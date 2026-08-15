import { describe, expect, test } from "bun:test";

import { SimulatedInverter } from "./simulator";
import type { InverterProfile, MetricDef, MetricValues, SimContext } from "./types";

/** A metric with the defaults the simulator cares about; override per test. */
const m = (over: Partial<MetricDef> & { key: string }): MetricDef => ({
  topic: over.key.replaceAll(".", "/"),
  label: over.key,
  unit: null,
  group: "inverter",
  type: "U_WORD",
  addresses: [1],
  scale: 1,
  access: "r",
  ...over,
});

const profileOf = (metrics: MetricDef[], simulate?: (ctx: SimContext) => MetricValues) =>
  ({
    id: "sim-test",
    name: "Sim Test",
    manufacturer: "Acme",
    metrics,
    simulate,
  }) satisfies InverterProfile;

describe("the profile's own simulate hook", () => {
  test("supplies the values it models and the sample is stamped with the profile id", async () => {
    const sim = new SimulatedInverter(
      profileOf([m({ key: "battery.soc", unit: "%" })], () => ({ "battery.soc": 73 })),
    );

    const sample = await sim.read();

    expect(sample.metrics["battery.soc"]).toBe(73);
    expect(sample.inverterId).toBe("sim-test");
    expect(Date.parse(sample.time)).not.toBeNaN();
  });

  test("a modelled zero is a reading, not a gap — it never falls back to 230 V", async () => {
    // A hybrid at night really does report 0 V on an idle port. `0 ?? x` must
    // stay 0; `0 || x` would silently invent a nominal voltage.
    const sim = new SimulatedInverter(
      profileOf([m({ key: "grid.voltage", unit: "V" })], () => ({ "grid.voltage": 0 })),
    );

    expect((await sim.read()).metrics["grid.voltage"]).toBe(0);
  });

  test("a negative modelled value survives untouched", async () => {
    // Battery power is signed: negative = discharging.
    const sim = new SimulatedInverter(
      profileOf([m({ key: "battery.power", unit: "W", type: "S_WORD" })], () => ({
        "battery.power": -1450,
      })),
    );

    expect((await sim.read()).metrics["battery.power"]).toBe(-1450);
  });

  test("metrics the hook omits are filled generically, per unit", async () => {
    const sim = new SimulatedInverter(
      profileOf(
        [
          m({ key: "battery.soc", unit: "%" }),
          m({ key: "grid.voltage", unit: "V" }),
          m({ key: "gen.voltage", unit: "V", group: "generator" }),
          m({ key: "inverter.temperature", unit: "°C" }),
          m({ key: "settings.grid_charge", unit: null }),
        ],
        () => ({}),
      ),
    );

    const { metrics } = await sim.read();

    expect(metrics["battery.soc"]).toBe(50);
    expect(metrics["grid.voltage"]).toBe(230);
    // A generator that is not running sits at 0 V, not at mains voltage.
    expect(metrics["gen.voltage"]).toBe(0);
    expect(metrics["inverter.temperature"]).toBe(25);
    expect(metrics["settings.grid_charge"]).toBe(0);
  });

  test("the first sample reports no elapsed time, later ones report the gap", async () => {
    const seen: number[] = [];
    const sim = new SimulatedInverter(
      profileOf([m({ key: "x" })], (ctx) => {
        seen.push(ctx.dtSec);
        return { x: 1 };
      }),
    );

    await sim.read();
    await Bun.sleep(15);
    await sim.read();

    expect(seen[0]).toBe(0);
    expect(seen[1]).toBeGreaterThan(0);
    expect(seen[1]).toBeLessThan(5);
  });

  test("the state object is the same one across reads, so counters can integrate", async () => {
    const sim = new SimulatedInverter(
      profileOf([m({ key: "production.total", unit: "kWh" })], (ctx) => {
        ctx.state.total = (ctx.state.total ?? 0) + 1;
        return { "production.total": ctx.state.total };
      }),
    );

    await sim.read();
    expect((await sim.read()).metrics["production.total"]).toBe(2);
  });
});

describe("profiles without a simulate hook", () => {
  test("fall back to the generic role-based model", async () => {
    const sim = new SimulatedInverter(
      profileOf([
        m({ key: "pv.total", unit: "W", role: "pv.total.power" }),
        m({ key: "soc", unit: "%", role: "battery.soc" }),
      ]),
    );

    const { metrics } = await sim.read();

    // The generic model drives these from the clock and its own state, so the
    // assertion is that they are *modelled*, not the fallback constants.
    expect(metrics.soc).toBeGreaterThanOrEqual(15);
    expect(metrics.soc).toBeLessThanOrEqual(100);
    expect(metrics.soc).not.toBe(50);
    expect(metrics["pv.total"]).toBeGreaterThanOrEqual(0);
  });
});

describe("computed and RAW metrics", () => {
  test("computed metrics are derived after the model, never faked by the fallback", async () => {
    const sim = new SimulatedInverter(
      profileOf(
        [
          m({ key: "dc.pv1.power", unit: "W" }),
          m({ key: "dc.pv2.power", unit: "W" }),
          m({
            key: "dc.total_power",
            unit: "W",
            addresses: [],
            compute: (v) => (v["dc.pv1.power"] ?? 0) + (v["dc.pv2.power"] ?? 0),
          }),
        ],
        () => ({ "dc.pv1.power": 1200, "dc.pv2.power": 800 }),
      ),
    );

    expect((await sim.read()).metrics["dc.total_power"]).toBe(2000);
  });

  test("a computed metric even overrides what the hook modelled for it", async () => {
    const sim = new SimulatedInverter(
      profileOf(
        [
          m({ key: "a", unit: "W" }),
          m({ key: "b", unit: "W", addresses: [], compute: (v) => (v.a ?? 0) * 2 }),
        ],
        () => ({ a: 10, b: 999 }),
      ),
    );

    expect((await sim.read()).metrics.b).toBe(20);
  });

  test("RAW registers carry no numeric value and stay out of the sample", async () => {
    const sim = new SimulatedInverter(
      profileOf([m({ key: "system.time", type: "RAW", addresses: [22, 23, 24] })], () => ({})),
    );

    const { metrics } = await sim.read();

    expect("system.time" in metrics).toBe(false);
  });
});

describe("writes", () => {
  const writableProfile = () =>
    profileOf(
      [
        m({
          key: "settings.battery.max_charge_current",
          unit: "A",
          access: "rw",
          range: { min: 0, max: 300 },
        }),
        m({ key: "battery.soc", unit: "%" }),
      ],
      () => ({ "settings.battery.max_charge_current": 120, "battery.soc": 61 }),
    );

  test("a written setting round-trips and keeps winning over the model", async () => {
    const sim = new SimulatedInverter(writableProfile());

    await sim.write("settings.battery.max_charge_current", 40);

    expect((await sim.read()).metrics["settings.battery.max_charge_current"]).toBe(40);
    // Still overridden on the next poll — a setting does not decay back.
    expect((await sim.read()).metrics["settings.battery.max_charge_current"]).toBe(40);
  });

  test("writing zero sticks — it is a real setpoint, not an unset override", async () => {
    const sim = new SimulatedInverter(writableProfile());

    await sim.write("settings.battery.max_charge_current", 0);

    expect((await sim.read()).metrics["settings.battery.max_charge_current"]).toBe(0);
  });

  test("the last write wins", async () => {
    const sim = new SimulatedInverter(writableProfile());

    await sim.write("settings.battery.max_charge_current", 40);
    await sim.write("settings.battery.max_charge_current", 95);

    expect((await sim.read()).metrics["settings.battery.max_charge_current"]).toBe(95);
  });

  test("a read-only metric is refused, and refusing it changes nothing", async () => {
    const sim = new SimulatedInverter(writableProfile());

    await expect(sim.write("battery.soc", 12)).rejects.toThrow("metric is read-only: battery.soc");
    expect((await sim.read()).metrics["battery.soc"]).toBe(61);
  });

  test("an unknown key is refused by name", async () => {
    const sim = new SimulatedInverter(writableProfile());

    await expect(sim.write("settings.does_not_exist", 1)).rejects.toThrow(
      "unknown metric: settings.does_not_exist",
    );
  });

  test("the simulator does not enforce the profile's range — the caller does", async () => {
    // Documents the seam: clamping lives in the write path above the source, so
    // the simulator must not silently "fix" an out-of-range command.
    const sim = new SimulatedInverter(writableProfile());

    await sim.write("settings.battery.max_charge_current", 5000);

    expect((await sim.read()).metrics["settings.battery.max_charge_current"]).toBe(5000);
  });
});

describe("shutdown", () => {
  test("close resolves and leaves an already-written override intact", async () => {
    const sim = new SimulatedInverter(profileOf([m({ key: "s", access: "rw" })], () => ({ s: 1 })));
    await sim.write("s", 7);

    await sim.close();
    // Closing a simulated source has nothing to tear down; a second close is
    // just as harmless as the first.
    await sim.close();

    expect((await sim.read()).metrics.s).toBe(7);
  });
});
