/**
 * The Integrations tab's rules.
 *
 * `app_settings.mqtt` used to hold the broker itself — URL, username, a masked
 * password — and the EVCC ingest borrowed it, which is why the two could never
 * be on different brokers (#217). Both records now NAME a `kind = 'mqtt'`
 * connection instead, so what has to be decided here is: which connections may
 * be named, how a null id survives a native `<select>` (whose values are
 * strings, and which has no null), and when a form is not yet sendable.
 */

import { describe, expect, test } from "bun:test";

import type { ConnectionView } from "./devices/device-types";
import {
  NO_BROKER,
  brokerIdOf,
  brokerOptions,
  evccConfigBody,
  evccFormFrom,
  mqttConfigBody,
  mqttFormFrom,
} from "./mqtt-config-form";

const gateway = {
  id: 3,
  name: "Gateway 1",
  kind: "modbus",
  params: {
    host: "10.0.0.5",
    port: 502,
    transport: "tcp",
    timeoutMs: 2000,
    pollIntervalMs: 1000,
  },
} satisfies ConnectionView;

const broker = (id: number, name: string, brokerUrl: string) =>
  ({
    id,
    name,
    kind: "mqtt",
    params: { brokerUrl, hasPassword: false },
  }) satisfies ConnectionView;

describe("brokerOptions", () => {
  test("only the MQTT connections, labelled by name and broker host", () => {
    expect(
      brokerOptions([
        gateway,
        broker(7, "Home broker", "mqtt://hass.ee.lan:1883"),
        broker(9, "Cloud", "mqtts://broker.example.com:8883"),
      ]),
    ).toEqual([
      { value: "7", label: "Home broker · hass.ee.lan" },
      { value: "9", label: "Cloud · broker.example.com" },
    ]);
  });

  test("a single broker is the whole list", () => {
    expect(brokerOptions([broker(7, "Home broker", "mqtt://b:1883")])).toEqual([
      { value: "7", label: "Home broker · b" },
    ]);
  });

  // The empty case is the one the operator meets on a fresh install, and the
  // card has to say "add a connection first" rather than render a select with
  // nothing in it.
  test("no brokers at all is an empty list, gateways or not", () => {
    expect(brokerOptions([])).toEqual([]);
    expect(brokerOptions([gateway])).toEqual([]);
  });

  test("a broker with no URL yet reads as its name alone", () => {
    expect(brokerOptions([broker(7, "Home broker", "")])).toEqual([
      { value: "7", label: "Home broker" },
    ]);
  });
});

describe("the null connection id across a native select", () => {
  test("anything that is not a positive integer is off", () => {
    expect(brokerIdOf("7")).toBe(7);
    expect(brokerIdOf(NO_BROKER)).toBeNull();
    expect(brokerIdOf("nope")).toBeNull();
    expect(brokerIdOf("0")).toBeNull();
    expect(brokerIdOf("-3")).toBeNull();
    expect(brokerIdOf("1.5")).toBeNull();
  });
});

describe("the Home Assistant export form", () => {
  const config = {
    connectionId: 7,
    topicPrefix: "sunreye",
    haDiscoveryEnabled: true,
    haDiscoveryPrefix: "homeassistant",
  };

  test("reads the stored config, the broker id as a select value", () => {
    expect(mqttFormFrom(config)).toEqual({
      brokerChoice: "7",
      topicPrefix: "sunreye",
      haDiscoveryEnabled: true,
      haDiscoveryPrefix: "homeassistant",
    });
  });

  // A null connection IS "off" since #217 — there is no `enabled` flag left to
  // disagree with it.
  test("no broker reads as the off choice", () => {
    expect(mqttFormFrom({ ...config, connectionId: null }).brokerChoice).toBe(NO_BROKER);
  });

  test("writes it back, trimming the prefixes", () => {
    expect(
      mqttConfigBody({
        brokerChoice: "7",
        topicPrefix: " sunreye ",
        haDiscoveryEnabled: false,
        haDiscoveryPrefix: " homeassistant ",
      }),
    ).toEqual({
      connectionId: 7,
      topicPrefix: "sunreye",
      haDiscoveryEnabled: false,
      haDiscoveryPrefix: "homeassistant",
    });
  });

  test("the off choice writes a null connection", () => {
    expect(
      mqttConfigBody(mqttFormFrom({ ...config, connectionId: null }))?.connectionId,
    ).toBeNull();
  });

  // Both prefixes are `min(1)` on the server, so a blank one is a 400 rather
  // than a default — the save button binds its `disabled` to this null.
  test.each([
    ["a blank topic prefix", { topicPrefix: "  " }],
    ["a blank discovery prefix", { haDiscoveryPrefix: "" }],
  ])("is null for %s", (_label, over) => {
    expect(mqttConfigBody({ ...mqttFormFrom(config), ...over })).toBeNull();
  });
});

describe("the EVCC form", () => {
  const config = { enabled: true, connectionId: 7, topicRoot: "evcc", subtractFromHome: true };

  test("round-trips, with its OWN broker choice", () => {
    const form = evccFormFrom(config);
    expect(form).toEqual({
      enabled: true,
      brokerChoice: "7",
      topicRoot: "evcc",
      subtractFromHome: true,
    });
    expect(evccConfigBody(form)).toEqual(config);
  });

  test("an unbound ingest reads and writes a null connection", () => {
    const form = evccFormFrom({ ...config, connectionId: null });
    expect(form.brokerChoice).toBe(NO_BROKER);
    expect(evccConfigBody(form)?.connectionId).toBeNull();
  });

  // `topicRoot` is `min(1)` server-side — a blank one is a 400 whether the
  // ingest is enabled or not, so it blocks the save either way rather than
  // being quietly replaced with the schema's default.
  test("the topic root is trimmed; a blank one blocks the save, enabled or not", () => {
    expect(evccConfigBody({ ...evccFormFrom(config), topicRoot: " evcc " })?.topicRoot).toBe(
      "evcc",
    );
    expect(evccConfigBody({ ...evccFormFrom(config), topicRoot: "   " })).toBeNull();
    expect(evccConfigBody({ ...evccFormFrom(config), enabled: false, topicRoot: "" })).toBeNull();
  });

  test("a disabled ingest still round-trips its broker and its topic", () => {
    expect(evccConfigBody({ ...evccFormFrom(config), enabled: false })).toEqual({
      ...config,
      enabled: false,
    });
  });
});
