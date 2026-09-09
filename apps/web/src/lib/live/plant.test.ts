import { describe, expect, it } from "bun:test";
import type { EvccState } from "@SunReye/contracts/evcc";
import type { WsTopicPayloads } from "@SunReye/contracts/ws";
import { evccStalenessCadenceMs } from "$lib/evcc/feed";
import { PlantFeed, PlantReadings, animatable, formatReading, stalenessTickMs } from "./plant";

const sample = (metrics: Record<string, number>): WsTopicPayloads["metrics"] => ({
  time: "2026-08-16T10:00:00.000Z",
  inverterId: "inv-1",
  metrics,
});

const evccState = (loadpoints: EvccState["loadpoints"]): EvccState =>
  ({ reachable: true, loadpoints }) as EvccState;

const loadpoint = (chargePowerLive: number) =>
  ({ chargePowerLive }) as EvccState["loadpoints"][number];

/** A bus double: hand frames to whatever subscribed, and count the leases. */
function fakeBus() {
  const handlers = new Map<string, (data: never) => void>();
  const released: string[] = [];
  return {
    released,
    push<K extends "metrics" | "plant" | "evcc">(topic: K, data: WsTopicPayloads[K]): void {
      handlers.get(topic)?.(data as never);
    },
    subscribe<K extends "metrics" | "plant" | "evcc">(
      topic: K,
      on: (data: WsTopicPayloads[K]) => void,
    ): () => void {
      handlers.set(topic, on as (data: never) => void);
      return () => {
        handlers.delete(topic);
        released.push(topic);
      };
    },
  };
}

describe("canonical plant readings", () => {
  it("0 W is a reading, not an absent value", () => {
    // The whole class of bug this phase is about: a falsy check standing in for
    // a presence check, and a fallback taking over on a perfectly good zero.
    const readings = new PlantReadings({ cadenceMs: () => 1000 });
    readings.observe("metrics", "load.power", 0, 0);
    expect(readings.read("load.power", 0)).toEqual({ value: 0, stale: false });
  });

  it("a negative grid power is a reading — that is export", () => {
    const readings = new PlantReadings({ cadenceMs: () => 1000 });
    readings.observe("metrics", "grid.power", -2400, 0);
    expect(readings.read("grid.power", 0)).toEqual({ value: -2400, stale: false });
  });

  it("a value nothing has ever reported is absent, and absent is not stale", () => {
    // Nothing arrived, so nothing has aged. The UI shows an em dash either way,
    // but "the profile has no such register" and "the feed died" are different
    // facts and the marker says which.
    const readings = new PlantReadings({ cadenceMs: () => 1000 });
    expect(readings.read("battery.soc", 10_000)).toEqual({ value: undefined, stale: false });
  });

  it("a reading survives three cadences and goes stale past them", () => {
    const readings = new PlantReadings({ cadenceMs: () => 1000 });
    readings.observe("metrics", "pv.total.power", 4200, 0);
    expect(readings.read("pv.total.power", 3000).stale).toBe(false);
    expect(readings.read("pv.total.power", 3001).stale).toBe(true);
    // The value is still handed over: the panel may show what was last true,
    // it just may not animate it as if it were current.
    expect(readings.read("pv.total.power", 3001).value).toBe(4200);
    expect(animatable(readings.read("pv.total.power", 3001))).toBeUndefined();
    expect(animatable(readings.read("pv.total.power", 3000))).toBe(4200);
  });

  it("staleness follows the owning topic's own cadence", () => {
    // EVCC publishes on MQTT traffic, not on our poll; judging it by the
    // metrics cadence would mark a perfectly normal quiet minute as dead.
    const readings = new PlantReadings({
      cadenceMs: (topic) => (topic === "evcc" ? 10_000 : 1000),
    });
    readings.observe("metrics", "load.power", 700, 0);
    readings.observe("evcc", "evcc.charge.power", 7000, 0);
    expect(readings.read("load.power", 5000).stale).toBe(true);
    expect(readings.read("evcc.charge.power", 5000).stale).toBe(false);
  });

  it("a register that stops being reported goes absent, not frozen", () => {
    // A profile swap (or a hidden metric) can take a role away mid-session. The
    // last value must not linger as if it were still being measured.
    const readings = new PlantReadings({ cadenceMs: () => 1000 });
    readings.observe("metrics", "load.power", 700, 0);
    readings.observe("metrics", "load.power", undefined, 1000);
    expect(readings.read("load.power", 1000)).toEqual({ value: undefined, stale: false });
  });

  it("a topic cannot report a value it does not own", () => {
    // The runtime half of the ownership rule: even if a caller gets past the
    // types, the automations feed cannot become a source of house load.
    const readings = new PlantReadings({ cadenceMs: () => 1000 });
    // @ts-expect-error -- `load.power` is owned by metrics, and the type says so
    const accepted = readings.observe("automations", "load.power", 4321, 0);
    expect(accepted).toBe(false);
    expect(readings.read("load.power", 0).value).toBeUndefined();
  });
});

describe("an idle charger on a healthy broker is not stale", () => {
  // The pairing the shell wires up, exercised end to end: EVCC's measured
  // spacing is clamped to 10 s for the glide, and feeding that straight in as a
  // freshness window declares a reachable charger dead between two of its own
  // publishes. `status.evChargeW` is non-null whenever EVCC is reachable, so
  // that row *is* on screen — flapping "0 W · stale" on working hardware.
  const readings = () =>
    new PlantReadings({
      cadenceMs: (topic) => (topic === "evcc" ? evccStalenessCadenceMs(10_000) : 1000),
    });

  it("survives a full quiet publish loop", () => {
    const r = readings();
    r.observe("evcc", "evcc.charge.power", 0, 0);
    // EVCC's loop runs 10–30 s and the server emits on change only, so 30 s of
    // silence is the normal case, not an outage.
    expect(r.read("evcc.charge.power", 30_000).stale).toBe(false);
  });

  it("still catches a charger that has actually stopped", () => {
    // Three of the slowest healthy loop. A feed that speaks every half minute
    // and has said nothing for 90 s is genuinely gone.
    const r = readings();
    r.observe("evcc", "evcc.charge.power", 4200, 0);
    expect(r.read("evcc.charge.power", 90_000).stale).toBe(false);
    expect(r.read("evcc.charge.power", 90_001).stale).toBe(true);
  });
});

describe("how often the staleness clock has to tick", () => {
  it("ticks no slower than the soonest reading can expire", () => {
    // The EVCC window is the short one here, so an hourly metrics poll must not
    // set the pace: the charger would go stale unseen for most of an hour.
    expect(stalenessTickMs([3_600_000, 30_000], 1000)).toBe(30_000);
  });

  it("does not repaint faster than a 1 Hz plant needs", () => {
    expect(stalenessTickMs([1000, 30_000], 1000)).toBe(1000);
    expect(stalenessTickMs([200, 30_000], 1000)).toBe(1000);
  });

  it("falls back to the floor when no feed has a cadence yet", () => {
    // `Math.min()` of nothing is Infinity, which would park the ticker forever.
    expect(stalenessTickMs([], 1000)).toBe(1000);
  });
});

describe("what a reading looks like on screen", () => {
  const fmtW = (w: number) => `${w} W`;

  it("an absent reading is an em dash — a missing number is honest", () => {
    expect(formatReading({ value: undefined, stale: false }, fmtW, "stale")).toBe("—");
  });

  it("a zero reading prints as zero, not as an em dash", () => {
    expect(formatReading({ value: 0, stale: false }, fmtW, "stale")).toBe("0 W");
  });

  it("a stale reading keeps its number but says so", () => {
    // The number was true once and is worth showing; what it must not do is
    // pass for current.
    expect(formatReading({ value: 812, stale: true }, fmtW, "stale")).toBe("812 W · stale");
  });
});

/** The source hooks for a dashboard showing one device. */
const selectedDevice = (slug: string) => ({
  acceptsFrame: (inverterId: string | undefined) => inverterId === slug,
  isPlant: () => false,
});
/** The source hooks for a dashboard showing the plant. */
const selectedPlant = () => ({ acceptsFrame: () => false, isPlant: () => true });

describe("the canonical feed's wiring", () => {
  it("a metrics frame becomes the canonical reading for every role the profile maps", () => {
    const bus = fakeBus();
    const readings = new PlantReadings({ cadenceMs: () => 1000 });
    const feed = new PlantFeed(readings, {
      subscribe: (topic, on) => bus.subscribe(topic, on),
      ...selectedDevice("inv-1"),
      metricKey: (id) => (id === "load.power" ? "load_total_power" : undefined),
      now: () => 0,
      onChange: () => {},
    });
    feed.lease();
    bus.push("metrics", sample({ load_total_power: 812 }));
    expect(readings.read("load.power", 0)).toEqual({ value: 812, stale: false });
  });

  it("a profile with no load.power role leaves house load absent — never the engine's number", () => {
    // Exactly the plant that produced the bug: `byRole('load.power')` resolves
    // to nothing, and the panel used to reach for `status.loadW`.
    const bus = fakeBus();
    const readings = new PlantReadings({ cadenceMs: () => 1000 });
    const feed = new PlantFeed(readings, {
      subscribe: (topic, on) => bus.subscribe(topic, on),
      ...selectedDevice("inv-1"),
      metricKey: () => undefined,
      now: () => 0,
      onChange: () => {},
    });
    feed.lease();
    bus.push("metrics", sample({ some_other_register: 812 }));
    expect(readings.read("load.power", 0).value).toBeUndefined();
  });

  it("EV charge power rides the EVCC topic, and an unreachable charger reports nothing", () => {
    const bus = fakeBus();
    const readings = new PlantReadings({ cadenceMs: () => 1000 });
    const feed = new PlantFeed(readings, {
      subscribe: (topic, on) => bus.subscribe(topic, on),
      ...selectedDevice("inv-1"),
      metricKey: () => undefined,
      now: () => 0,
      onChange: () => {},
    });
    feed.lease();
    bus.push("evcc", evccState([loadpoint(4200), loadpoint(0)]));
    expect(readings.read("evcc.charge.power", 0).value).toBe(4200);
    // No loadpoints at all is "nothing to say", which is not the same claim as
    // "the car is drawing 0 W".
    bus.push("evcc", evccState([]));
    expect(readings.read("evcc.charge.power", 0).value).toBeUndefined();
  });

  it("notifies once per frame so the reactive shell can repaint", () => {
    const bus = fakeBus();
    const readings = new PlantReadings({ cadenceMs: () => 1000 });
    let changes = 0;
    const feed = new PlantFeed(readings, {
      subscribe: (topic, on) => bus.subscribe(topic, on),
      ...selectedDevice("inv-1"),
      metricKey: () => "k",
      now: () => 0,
      onChange: () => {
        changes += 1;
      },
    });
    feed.lease();
    bus.push("metrics", sample({ k: 1 }));
    bus.push("evcc", evccState([loadpoint(1)]));
    expect(changes).toBe(2);
  });

  it("under a selected device, another device's frame is not its reading", () => {
    // Two inverters, one poll loop each: the frame that arrives last must not
    // overwrite the number of the device the viewer chose.
    const bus = fakeBus();
    const readings = new PlantReadings({ cadenceMs: () => 1000 });
    const feed = new PlantFeed(readings, {
      subscribe: (topic, on) => bus.subscribe(topic, on),
      ...selectedDevice("inv-1"),
      metricKey: () => "k",
      now: () => 0,
      onChange: () => {},
    });
    feed.lease();
    bus.push("metrics", { ...sample({ k: 100 }), inverterId: "inv-1" });
    bus.push("metrics", { ...sample({ k: 5 }), inverterId: "inv-2" });
    expect(readings.read("load.power", 0).value).toBe(100);
  });

  it("under the plant, the fold on the `plant` topic is the reading and device frames are not", () => {
    const bus = fakeBus();
    const readings = new PlantReadings({ cadenceMs: () => 1000 });
    const feed = new PlantFeed(readings, {
      subscribe: (topic, on) => bus.subscribe(topic, on),
      ...selectedPlant(),
      metricKey: () => "k",
      now: () => 0,
      onChange: () => {},
    });
    feed.lease();
    bus.push("metrics", { ...sample({ k: 100 }), inverterId: "inv-1" });
    expect(readings.read("load.power", 0).value).toBeUndefined();
    bus.push("plant", {
      time: "2026-01-01T00:00:00Z",
      metrics: { k: 150 },
      members: ["inv-1", "inv-2"],
      stale: [],
    });
    expect(readings.read("load.power", 0)).toEqual({ value: 150, stale: false });
  });

  it("the lease gives every topic it took back", () => {
    const bus = fakeBus();
    const readings = new PlantReadings({ cadenceMs: () => 1000 });
    const feed = new PlantFeed(readings, {
      subscribe: (topic, on) => bus.subscribe(topic, on),
      ...selectedDevice("inv-1"),
      metricKey: () => undefined,
      now: () => 0,
      onChange: () => {},
    });
    const release = feed.lease();
    release();
    expect(bus.released.sort()).toEqual(["evcc", "metrics", "plant"]);
    // A Svelte cleanup can run twice; the second must not release a topic a
    // later lease has since taken.
    release();
    expect(bus.released.length).toBe(3);
  });
});
