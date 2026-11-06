import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { CORPUS_DIR } from "./corpus";

type Row = Record<string, any>;

const rows: Row[] = (await readFile(join(CORPUS_DIR, "mqtt.ndjson"), "utf8"))
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));
const byName = (name: string): Row => {
  const row = rows.find((r) => r.case === name);
  if (!row) throw new Error(`no case ${name}`);
  return row;
};
const stepsOf = (name: string): Row[] => byName(name).output.steps;
const publishedIn = (name: string): Row[] => stepsOf(name).flatMap((s) => s.published);

/** Entity kinds read off `discoveryConfig` and `forecastDiscoveryConfig`: component x device_class x state_class. */
const ENTITY_KINDS = [
  "sensor-power",
  "sensor-apparent-power",
  "sensor-energy-cumulative",
  "sensor-voltage",
  "sensor-current",
  "sensor-frequency",
  "sensor-temperature",
  "sensor-battery-soc",
  "sensor-percent-plain",
  "sensor-unitless",
  "sensor-unit-without-class",
  "sensor-enum-label",
  "sensor-status-no-state-class",
  "forecast-raw",
  "forecast-usable",
];

describe("the mqtt oracle fixture", () => {
  test("case names are unique", () => {
    const names = rows.map((r) => r.case);
    expect(new Set(names).size).toBe(names.length);
  });

  test("every entity kind has a discovery case", () => {
    const kinds = rows.filter((r) => r.entityKind !== undefined).map((r) => r.entityKind);
    expect(kinds.sort()).toEqual([...ENTITY_KINDS].sort());
  });

  test("a power sensor announces under the slug identity, retained", () => {
    const { announcement } = byName("discovery/sensor-power").output;
    expect(announcement.topic).toBe(
      "homeassistant/sensor/sunreye_haus-sud_inverter/pv_power/config",
    );
    expect(announcement.options).toEqual({ retain: true });
    expect(announcement.json).toEqual({
      name: "PV power",
      unique_id: "sunreye_haus-sud_inverter_pv_power",
      default_entity_id: "sensor.sunreye_inverter_pv_power",
      state_topic: "sunreye/haus-sud/inverter/pv/power",
      availability_topic: "sunreye/haus-sud/inverter/status",
      unit_of_measurement: "W",
      device: {
        identifiers: ["sunreye_haus-sud_inverter"],
        name: "Deye SG05LP3",
        manufacturer: "Deye",
        model: "deye-sg05lp3",
      },
      device_class: "power",
      state_class: "measurement",
    });
  });

  test("a counter is total_increasing and the SOC percent is a battery", () => {
    const energy = byName("discovery/sensor-energy-cumulative").output.announcement.json;
    expect([energy.device_class, energy.state_class]).toEqual(["energy", "total_increasing"]);
    const soc = byName("discovery/sensor-battery-soc").output.announcement.json;
    expect(soc.device_class).toBe("battery");
    const plain = byName("discovery/sensor-percent-plain").output.announcement.json;
    expect("device_class" in plain).toBe(false);
  });

  test("the forecast sensors carry attributes topics and an energy class", () => {
    const raw = byName("discovery/forecast-raw").output.announcement;
    expect(raw.topic).toBe("homeassistant/sensor/sunreye_haus-sud_inverter/forecast/config");
    expect(raw.json.json_attributes_topic).toBe(
      "sunreye/haus-sud/inverter/forecast/raw/attributes",
    );
    const usable = byName("discovery/forecast-usable").output.announcement;
    expect(usable.topic).toBe(
      "homeassistant/sensor/sunreye_haus-sud_inverter/forecast_usable/config",
    );
    expect([usable.json.name, usable.json.unit_of_measurement, usable.json.state_class]).toEqual([
      "Solar forecast (usable)",
      "kWh",
      "measurement",
    ]);
  });

  test("a profile swap moves the description and keeps the identity", () => {
    const { before, after } = byName("discovery/profile-swap").output;
    expect(after.json.unique_id).toBe(before.json.unique_id);
    expect(after.json.device.identifiers).toEqual(before.json.device.identifiers);
    expect(after.json.device.model).toBe("sofar-hyd-6000");
    expect(before.json.device.model).toBe("deye-sg05lp3");
  });

  test("the topic layout is <prefix>/<plant>/<device>/<topic>, slugs verbatim", () => {
    const plain = byName("topics/plain").output;
    expect(plain.base).toBe("sunreye/haus-sud/inverter");
    expect(plain.availability).toBe("sunreye/haus-sud/inverter/status");
    expect(plain.state["battery.soc"]).toBe("sunreye/haus-sud/inverter/battery/soc");
    expect(plain.forecastAttributes.usable).toBe(
      "sunreye/haus-sud/inverter/forecast/usable/attributes",
    );
    expect(plain.identityPrefix).toBe("sunreye_haus-sud_inverter");
    const odd = byName("topics/awkward-slugs-verbatim").output;
    expect(odd.base).toBe("sunreye/Haus Süd/wr.1");
    expect(odd.identityPrefix).toBe("sunreye_Haus Süd_wr.1");
    expect(byName("topics/empty-slugs-verbatim").output.base).toBe("sunreye//");
  });

  test("a metric key is slugged to [A-Za-z0-9_-] for its object id", () => {
    const { slugs } = byName("slug/metric-keys").output;
    expect(slugs["pv.power"]).toBe("pv_power");
    expect(slugs["Süd Dach"]).toBe("S_d_Dach");
    expect(slugs[""]).toBe("");
  });

  test("a device name becomes a folded slug", () => {
    const { slugs } = byName("slugify/device-names").output;
    expect(slugs["Haus Süd"]).toBe("haus-sud");
    expect(slugs["Dach.Ost / 2"]).toBe("dach-ost-2");
    expect(slugs["!!!"]).toBe("");
    expect(slugs[""]).toBe("");
  });

  test("the namespace skips a retired device and refuses a blank spine", () => {
    expect(byName("namespace/retired-lowest-id").output.namespace).toEqual({
      plantSlug: "haus-sud",
      deviceSlug: "inverter-2",
    });
    expect(byName("namespace/blank-device-slug").output.error.name).toBe(
      "MissingMqttNamespaceError",
    );
    expect(byName("namespace/no-plant").output.error.name).toBe("MissingMqttNamespaceError");
  });

  test("connect announces online retained and the last will is offline retained at qos 0", () => {
    const { output } = byName("bridge/connect");
    expect(output.will).toEqual({
      topic: "sunreye/haus-sud/inverter/status",
      payload: "offline",
      qos: 0,
      retain: true,
    });
    expect(output.steps[0].published).toEqual([
      { topic: "sunreye/haus-sud/inverter/status", options: { retain: true }, payload: "online" },
    ]);
  });

  test("discovery on connect lists every catalog metric then both forecasts", () => {
    const topics = stepsOf("bridge/connect-discovery")[0]!.published.map((p: Row) => p.topic);
    expect(topics[0]).toBe("sunreye/haus-sud/inverter/status");
    expect(topics).toHaveLength(1 + 13 + 2);
    expect(topics.at(-1)).toBe(
      "homeassistant/sensor/sunreye_haus-sud_inverter/forecast_usable/config",
    );
  });

  test("a cycle publishes each present reading as a plain number, retained", () => {
    const sample = stepsOf("state/rounding-and-sign")[1]!;
    const payloads = Object.fromEntries(sample.published.map((p: Row) => [p.topic, p.payload]));
    expect(payloads["sunreye/haus-sud/inverter/pv/power"]).toBe("4321");
    expect(payloads["sunreye/haus-sud/inverter/battery/current"]).toBe("-12.34");
    expect(payloads["sunreye/haus-sud/inverter/grid/import"]).toBe("1234.5");
    // 1234 * 0.1 - 100 in binary floating point: the publisher sends String(value), noise included.
    expect(payloads["sunreye/haus-sud/inverter/battery/temperature"]).toBe("23.400000000000006");
    expect(sample.published.every((p: Row) => p.options.retain === true)).toBe(true);
  });

  test("zero is published, an absent register is not, an empty sample publishes nothing", () => {
    const zero = publishedIn("state/zero-and-missing").map((p) => [p.topic, p.payload]);
    expect(zero).toContainEqual(["sunreye/haus-sud/inverter/pv/power", "0"]);
    expect(zero.some(([t]) => t === "sunreye/haus-sud/inverter/grid/import")).toBe(false);
    expect(stepsOf("state/empty-sample").at(-1)!.published).toEqual([]);
  });

  test("the publisher ignores the age of a sample and goes quiet while offline", () => {
    const stale = byName("state/stale-sample-across-midnight");
    expect(stale.input.sampleTime < stale.input.now).toBe(true);
    expect(stale.input.sampleTime.slice(0, 10)).not.toBe(stale.input.now.slice(0, 10));
    expect(stepsOf("state/stale-sample-across-midnight").at(-1)!.published.length).toBeGreaterThan(
      0,
    );
    expect(stepsOf("state/offline-publishes-nothing").at(-1)!.published).toEqual([]);
  });

  test("the forecast state is today's kWh and the attributes carry the curve, retained", () => {
    const published = stepsOf("forecast/connected").at(-1)!.published;
    expect(published.map((p: Row) => p.topic)).toEqual([
      "sunreye/haus-sud/inverter/forecast/raw",
      "sunreye/haus-sud/inverter/forecast/raw/attributes",
      "sunreye/haus-sud/inverter/forecast/usable",
      "sunreye/haus-sud/inverter/forecast/usable/attributes",
    ]);
    expect(published.every((p: Row) => p.options.retain === true)).toBe(true);
    expect(Array.isArray(published[1]!.json.detailedForecast)).toBe(true);
    expect(stepsOf("forecast/null-is-a-noop").at(-1)!.published).toEqual([]);
  });

  test("close flips availability to offline before releasing", () => {
    const last = stepsOf("bridge/close").at(-1)!;
    expect(last.published).toEqual([
      { topic: "sunreye/haus-sud/inverter/status", options: { retain: true }, payload: "offline" },
    ]);
  });

  test("no command topic exists anywhere: nothing ends in /set, nothing subscribes, no command_topic", () => {
    const topics: string[] = [];
    const walk = (value: unknown): void => {
      if (Array.isArray(value)) return value.forEach(walk);
      if (value === null || typeof value !== "object") return;
      for (const [key, inner] of Object.entries(value)) {
        expect(key).not.toBe("command_topic");
        if (key === "topic" && typeof inner === "string") topics.push(inner);
        walk(inner);
      }
    };
    rows.forEach(walk);
    expect(topics.length).toBeGreaterThan(50);
    expect(topics.filter((t) => t.endsWith("/set"))).toEqual([]);
    const { subscribed, commandTopics, topics: all } = byName("topics/no-command-topic").output;
    expect(subscribed).toEqual([]);
    expect(commandTopics).toEqual([]);
    expect(all.filter((t: string) => t.endsWith("/set"))).toEqual([]);
  });
});
