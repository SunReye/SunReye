import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { CORPUS_DIR } from "./corpus";
import { createWire } from "./evcc";

type Row = Record<string, any>;

const rows: Row[] = (await readFile(join(CORPUS_DIR, "evcc.ndjson"), "utf8"))
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));
const byName = (name: string): Row => {
  const row = rows.find((r) => r.case === name);
  if (!row) throw new Error(`no case ${name}`);
  return row;
};
const finalState = (name: string): Row => byName(name).output.steps.at(-1).state;
const loadpoint = (name: string, index: number): Row =>
  finalState(name).loadpoints.find((l: Row) => l.index === index);
const parsedTopic = (name: string, topic: string): Row =>
  byName(name).output.find((t: Row) => t.topic === topic);

describe("the recording link", () => {
  test("records what is published and the connection state it is told", () => {
    const wire = createWire();
    expect(wire.link.connected).toBe(false);
    wire.setConnected(true);
    expect(wire.link.connected).toBe(true);
    wire.link.publish("evcc/loadpoints/1/mode/set", "pv");
    expect(wire.published).toEqual([{ topic: "evcc/loadpoints/1/mode/set", payload: "pv" }]);
    expect(wire.publishedTopics()).toEqual(["evcc/loadpoints/1/mode/set"]);
  });
});

describe("the evcc oracle fixture", () => {
  test("case names are unique and cover the five groups", () => {
    const names = rows.map((r) => r.case);
    expect(new Set(names).size).toBe(names.length);
    const groups = new Set(names.map((n) => n.split("/")[0]));
    expect([...groups].sort()).toEqual([
      "commands",
      "estimator",
      "fold",
      "payload",
      "readings",
      "topic",
    ]);
  });

  test("loadpoint topics are 1-based, nest their keys, and drop the count topic and /set echoes", () => {
    const at = (topic: string) => parsedTopic("topic/default-root", topic);
    expect(at("evcc/loadpoints/1/chargePower").loadpoint).toEqual({ index: 1, key: "chargePower" });
    expect(at("evcc/loadpoints/1/chargeCurrents/l1").loadpoint).toEqual({
      index: 1,
      key: "chargeCurrents/l1",
    });
    expect(at("evcc/loadpoints").loadpoint).toBeNull();
    expect(at("evcc/loadpoints/0/mode").loadpoint).toBeNull();
    expect(at("evcc/loadpoints/1/mode/set").loadpoint).toBeNull();
    expect(at("evcc/loadpoints/01/mode").loadpoint).toEqual({ index: 1, key: "mode" });
    expect(at("evcc/status").loadpoint).toBeNull();
    expect(at("evcc/vehicles/tesla_ble/capacity").vehicle).toEqual({
      name: "tesla_ble",
      key: "capacity",
    });
    expect(at("evcc/vehicles/tesla_ble/limitSoc/set").vehicle).toBeNull();
    const custom = (topic: string) => parsedTopic("topic/custom-root", topic);
    expect(custom("home/evcc/loadpoints/2/mode").loadpoint).toEqual({ index: 2, key: "mode" });
    expect(custom("evcc/loadpoints/2/mode").loadpoint).toBeNull();
  });

  test("payloads coerce to number, boolean, null or the verbatim string", () => {
    const value = (raw: string) =>
      byName("payload/coercion").output.find((p: Row) => p.raw === raw).value;
    expect(value("")).toBeNull();
    expect(value("null")).toBeNull();
    expect(value("true")).toBe(true);
    expect(value("True")).toBe("True");
    expect(value("0")).toBe(0);
    expect(value("-12.5")).toBe(-12.5);
    expect(value(" 42 ")).toBe(42);
    expect(value("0x10")).toBe(16);
    expect(value("1x")).toBe("1x");
    expect(value("NaN")).toBe("NaN");
  });

  test("a retained snapshot then live updates fold into one loadpoint", () => {
    const state = finalState("fold/retained-snapshot-then-live");
    expect(state.reachable).toBe(true);
    expect(state.loadpoints).toHaveLength(1);
    expect(loadpoint("fold/retained-snapshot-then-live", 1)).toMatchObject({
      title: "Carport",
      mode: "pv",
      chargePower: 4140,
      chargePowerLive: 4140,
      chargePowerSource: "measured",
      charging: true,
      connected: true,
      vehicleSoc: 54,
    });
  });

  test("the vehicle joins by vehicleName; a zero or unknown capacity is null", () => {
    expect(loadpoint("fold/vehicle-joined-by-name", 1)).toMatchObject({
      vehicleName: "tesla_ble",
      vehicleTitle: "tesla_ble",
      vehicleCapacityKwh: 75,
    });
    expect(loadpoint("fold/vehicle-joined-by-name", 2).vehicleCapacityKwh).toBeNull();
    expect(loadpoint("fold/vehicle-joined-by-name", 3).vehicleCapacityKwh).toBeNull();
  });

  test("the charge limit carries all three layers", () => {
    expect(loadpoint("fold/effective-limit-soc", 1)).toMatchObject({
      limitSoc: 0,
      effectiveLimitSoc: 80,
      vehicleLimitSoc: 90,
    });
  });

  test("offline EVCC, an unseen status and a dropped broker are unreachable", () => {
    expect(finalState("fold/evcc-offline").reachable).toBe(false);
    expect(finalState("fold/evcc-offline").loadpoints).toHaveLength(1);
    expect(finalState("fold/status-never-seen").reachable).toBe(false);
    expect(finalState("fold/broker-dropped").reachable).toBe(false);
    expect(finalState("fold/disabled")).toBeNull();
  });

  test("a cleared loadpoint stays listed with its last live power", () => {
    const gone = loadpoint("fold/loadpoint-vanishing", 2);
    expect(gone).toMatchObject({ title: null, chargePower: 0, chargePowerLive: 2000 });
  });

  test("zero and negative charge power anchor; a non-number does not", () => {
    expect(loadpoint("fold/charge-power-boundaries", 1)).toMatchObject({
      chargePower: 0,
      chargePowerLive: -50,
    });
  });

  test("a padded <root>/status still reads online", () => {
    expect(finalState("fold/status-padded").reachable).toBe(true);
  });

  test("with subtractFromHome a house-load step reaches the charge-power estimate", () => {
    const steps = byName("fold/subtract-estimates-3-phase").output.steps;
    expect(steps.at(-2).state.loadpoints[0]).toMatchObject({
      chargePowerLive: 4140,
      chargePowerSource: "measured",
    });
    expect(steps.at(-1).state.loadpoints[0]).toMatchObject({
      chargePower: 4140,
      chargePowerLive: 5520,
      chargePowerSource: "estimated",
    });
  });

  test("effectiveMaxCurrent and phasesActive bound the estimate", () => {
    expect(loadpoint("fold/subtract-clamps-at-max-current", 1)).toMatchObject({
      chargePower: 1380,
      chargePowerLive: 1518,
      chargePowerSource: "estimated",
    });
  });

  test("in now mode an upward house-load step is not the charger", () => {
    expect(loadpoint("fold/subtract-now-mode-upward-absorbed", 1)).toMatchObject({
      mode: "now",
      chargePowerLive: 4140,
      chargePowerSource: "measured",
    });
  });

  test("the estimator anchors, attributes a 2 A three-phase step and re-anchors", () => {
    const steps = byName("estimator/residual-then-re-anchor").output;
    expect(steps[0].live["1"]).toEqual({ watts: 4140, source: "measured" });
    expect(steps.at(-2).live["1"]).toEqual({ watts: 5520, source: "estimated" });
    expect(steps.at(-1).live["1"]).toEqual({ watts: 5000, source: "measured" });
  });

  test("now mode attributes only downward steps", () => {
    const steps = byName("estimator/now-mode-downward-only").output;
    expect(steps.at(-2).live["1"].watts).toBe(11040);
    expect(steps.at(-1).live["1"]).toEqual({ watts: 9660, source: "estimated" });
  });

  test("a second step inside 3 s is house load; at 3 s it is the charger", () => {
    expect(byName("estimator/rate-limit-2999ms").output.at(-1).live["1"].watts).toBe(5520);
    expect(byName("estimator/rate-limit-3000ms").output.at(-1).live["1"].watts).toBe(6900);
  });

  test("a step is clamped at zero", () => {
    expect(byName("estimator/clamp-at-zero").output.at(-1).live["1"]).toEqual({
      watts: 0,
      source: "estimated",
    });
  });

  test("the registrar ensures, reloads once, commits and retires a vanished loadpoint last", () => {
    const [first, second] = byName("readings/register-and-retire").output.syncs;
    expect(first.map((c: Row) => Object.keys(c)[0])).toEqual([
      "ensure",
      "ensure",
      "reload",
      "commit",
      "commit",
    ]);
    expect(second.map((c: Row) => Object.keys(c)[0])).toEqual(["commit", "forget"]);
    expect(second[1].forget).toBe("evcc-loadpoint-2");
  });

  test("a sample keeps absent values absent and states kWh", () => {
    const sample = byName("readings/sample-boundaries").output.syncs[0].find(
      (c: Row) => c.commit?.device === "evcc-loadpoint-1",
    ).commit.sample;
    expect(sample.metrics).toEqual({
      "ev.charge.power": 0,
      "ev.connected": 0,
      "ev.charging": 0,
    });
    const full = byName("readings/sample-boundaries").output.syncs[0].find(
      (c: Row) => c.commit?.device === "evcc-loadpoint-2",
    ).commit.sample;
    expect(full.metrics["ev.session.energy"]).toBe(12.345);
    expect(full.provenance).toEqual({ "ev.charge.power": "estimated" });
  });

  test("subtractFromHome rides on the state and leaves the readings alone", () => {
    const { off, on } = byName("readings/subtract-from-home").output;
    expect([off.state.subtractFromHome, on.state.subtractFromHome]).toEqual([false, true]);
    expect(on.committed).toEqual(off.committed);
  });

  test("no command topic: nothing subscribed or published ends in /set", () => {
    const { subscribed, published, commandTopics } = byName("commands/no-command-topic").output;
    expect(subscribed).toEqual(["evcc/status", "evcc/loadpoints/#", "evcc/vehicles/#"]);
    expect(published).toEqual([]);
    expect(commandTopics).toEqual([]);
  });
});
