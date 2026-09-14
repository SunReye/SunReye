/**
 * The connection dialog's rules, per KIND.
 *
 * A connection is no longer "a Modbus endpoint" (#217): the row carries a
 * `kind` and a `params` document, and the two arms share not one field. What
 * has to be decided outside the component is therefore which field set becomes
 * the wire params, which of them may be blank, and what an EDIT is allowed to
 * send — a PATCH carrying a different `kind` is answered 409 by the server, so
 * the draft never spells one.
 */

import { describe, expect, test } from "bun:test";

import {
  blankDraft,
  brokerHost,
  connectionAddress,
  connectionCreateBody,
  connectionParamsOf,
  connectionPatchBody,
  draftFromConnection,
  withTransport,
} from "./connection-draft";
import type { ConnectionView } from "./device-types";

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

const broker = {
  id: 4,
  name: "Home broker",
  kind: "mqtt",
  params: { brokerUrl: "mqtt://hass.ee.lan:1883", username: "mqtt", hasPassword: true },
} satisfies ConnectionView;

describe("blankDraft", () => {
  test("opens on Modbus with the column defaults, and carries an empty MQTT half", () => {
    const draft = blankDraft("Gateway 2");
    expect(draft.kind).toBe("modbus");
    expect(draft.name).toBe("Gateway 2");
    expect(draft.hasPassword).toBe(false);
    expect(draft.modbus).toEqual({
      host: "",
      port: 502,
      transport: "tcp",
      timeoutMs: 2000,
      pollIntervalMs: 1000,
    });
    expect(draft.mqtt).toEqual({ brokerUrl: "", username: "", password: "", clientId: "" });
  });

  test("can open on the broker arm instead", () => {
    expect(blankDraft("Broker", "mqtt").kind).toBe("mqtt");
  });
});

describe("draftFromConnection", () => {
  test("a Modbus row fills the Modbus half and leaves the broker half blank", () => {
    const draft = draftFromConnection(gateway);
    expect(draft.kind).toBe("modbus");
    expect(draft.name).toBe("Gateway 1");
    expect(draft.modbus.host).toBe("10.0.0.5");
    expect(draft.mqtt.brokerUrl).toBe("");
  });

  // The API never returns the password. `hasPassword` is what the placeholder
  // reads, and the field stays empty so an untouched save preserves the stored one.
  test("a broker row fills the broker half; the password is never seeded", () => {
    const draft = draftFromConnection(broker);
    expect(draft.kind).toBe("mqtt");
    expect(draft.mqtt).toEqual({
      brokerUrl: "mqtt://hass.ee.lan:1883",
      username: "mqtt",
      password: "",
      clientId: "",
    });
    expect(draft.hasPassword).toBe(true);
    expect(draft.modbus.host).toBe("");
  });

  test("an absent username or client id reads as empty, not as undefined", () => {
    const draft = draftFromConnection({
      ...broker,
      params: { brokerUrl: "mqtt://b:1883", hasPassword: false },
    });
    expect(draft.mqtt.username).toBe("");
    expect(draft.mqtt.clientId).toBe("");
    expect(draft.hasPassword).toBe(false);
  });
});

describe("connectionParamsOf — the kind switch", () => {
  test("the Modbus arm sends the five endpoint fields, host trimmed", () => {
    const draft = blankDraft("G");
    draft.modbus = { ...draft.modbus, host: " 10.0.0.9 ", port: 8899 };
    expect(connectionParamsOf(draft)).toEqual({
      kind: "modbus",
      params: {
        host: "10.0.0.9",
        port: 8899,
        transport: "tcp",
        timeoutMs: 2000,
        pollIntervalMs: 1000,
      },
    });
  });

  test("the broker arm sends the URL trimmed, and only the optionals that were typed", () => {
    const draft = blankDraft("B", "mqtt");
    draft.mqtt = { brokerUrl: " mqtt://b:1883 ", username: "", password: "", clientId: "" };
    expect(connectionParamsOf(draft)).toEqual({
      kind: "mqtt",
      params: { brokerUrl: "mqtt://b:1883" },
    });
  });

  // `clientId` is `min(1)` on the server: an empty string is a 400, not a
  // default, so a blank field has to be absent rather than "".
  test("a typed username, password and client id ride along", () => {
    const draft = blankDraft("B", "mqtt");
    draft.mqtt = {
      brokerUrl: "mqtt://b:1883",
      username: "mqtt",
      password: "s3cret",
      clientId: "sunreye-1",
    };
    expect(connectionParamsOf(draft)).toEqual({
      kind: "mqtt",
      params: {
        brokerUrl: "mqtt://b:1883",
        username: "mqtt",
        password: "s3cret",
        clientId: "sunreye-1",
      },
    });
  });

  test.each([
    ["a Modbus draft with no host", blankDraft("G")],
    [
      "a Modbus draft with a blank host",
      (() => {
        const d = blankDraft("G");
        d.modbus.host = "   ";
        return d;
      })(),
    ],
    ["a broker draft with no URL", blankDraft("B", "mqtt")],
  ])("is null for %s — the save button stays disabled", (_label, draft) => {
    expect(connectionParamsOf(draft)).toBeNull();
  });

  test("the arm not chosen cannot block the other one", () => {
    const draft = blankDraft("B", "mqtt");
    draft.mqtt.brokerUrl = "mqtt://b:1883";
    // The Modbus half is still empty, and irrelevant.
    expect(connectionParamsOf(draft)).not.toBeNull();
  });
});

describe("connectionCreateBody", () => {
  test("names the connection and carries its kind and params", () => {
    const draft = blankDraft(" Keller ");
    draft.modbus.host = "10.0.0.9";
    expect(connectionCreateBody(draft)).toEqual({
      name: "Keller",
      kind: "modbus",
      params: {
        host: "10.0.0.9",
        port: 502,
        transport: "tcp",
        timeoutMs: 2000,
        pollIntervalMs: 1000,
      },
    });
  });

  test("a nameless connection is not sendable — the server refuses an empty name", () => {
    const draft = blankDraft("   ");
    draft.modbus.host = "10.0.0.9";
    expect(connectionCreateBody(draft)).toBeNull();
  });

  test("an unfilled endpoint is not sendable either", () => {
    expect(connectionCreateBody(blankDraft("Keller"))).toBeNull();
  });
});

describe("connectionPatchBody", () => {
  // `PATCH /api/connections/:id` answers 409 with `field: "kind"` for a
  // DIFFERENT kind, and the row's own kind is the only thing the dialog could
  // truthfully send — so it sends none at all and the params are parsed against
  // the row's kind on the server.
  test("never spells a kind", () => {
    const draft = draftFromConnection(gateway);
    const patch = connectionPatchBody(draft);
    expect(patch).not.toBeNull();
    expect(Object.keys(patch!).sort()).toEqual(["name", "params"]);
  });

  test("an untouched broker edit omits the password, so the stored one survives", () => {
    expect(connectionPatchBody(draftFromConnection(broker))).toEqual({
      name: "Home broker",
      params: { brokerUrl: "mqtt://hass.ee.lan:1883", username: "mqtt" },
    });
  });

  test("a typed password replaces it", () => {
    const draft = draftFromConnection(broker);
    draft.mqtt.password = "new";
    expect(connectionPatchBody(draft)?.params).toEqual({
      brokerUrl: "mqtt://hass.ee.lan:1883",
      username: "mqtt",
      password: "new",
    });
  });

  test("is null while the draft is not sendable", () => {
    const draft = draftFromConnection(broker);
    draft.mqtt.brokerUrl = "";
    expect(connectionPatchBody(draft)).toBeNull();
  });
});

describe("brokerHost", () => {
  test.each([
    ["mqtt://hass.ee.lan:1883", "hass.ee.lan"],
    ["mqtts://broker.example.com:8883", "broker.example.com"],
    ["ws://10.0.0.4:9001/mqtt", "10.0.0.4"],
    ["mqtt://hass.ee.lan", "hass.ee.lan"],
    // No scheme at all is what an operator types; it is still the host.
    ["hass.ee.lan:1883", "hass.ee.lan"],
    ["hass.ee.lan", "hass.ee.lan"],
    ["  mqtt://hass.ee.lan:1883  ", "hass.ee.lan"],
    ["", ""],
    ["://", "://"],
  ])("%p reads as %p", (url, expected) => {
    expect(brokerHost(url)).toBe(expected);
  });
});

describe("connectionAddress", () => {
  test("a gateway shows host and port; a broker shows the broker's host", () => {
    expect(connectionAddress(gateway)).toBe("10.0.0.5:502");
    expect(connectionAddress(broker)).toBe("hass.ee.lan");
  });

  test("an addressless row reads as empty — a real state, not a crash", () => {
    expect(connectionAddress({ ...gateway, params: { ...gateway.params, host: "" } })).toBe("");
    expect(connectionAddress({ ...broker, params: { brokerUrl: "", hasPassword: false } })).toBe(
      "",
    );
  });
});

/**
 * THE SOLARMAN ARM.
 *
 * The Solarman/IGEN logger stick that ships in the box with most Deye and
 * Sunsynk hybrids does not speak Modbus TCP on 502: it wraps Modbus in a vendor
 * envelope on 8899, addressed by the stick's own serial number. Two of those
 * three facts belong to the framing, so picking the framing has to carry the
 * port with it — an operator who picks "Solarman" and is then refused on 502
 * has been asked to know a number their choice already implies.
 *
 * What it must NOT do is overwrite a port somebody typed. A stick behind a port
 * forward is a real arrangement, and losing that number to a mis-click on a
 * three-option select is the same loss the two-halved draft exists to prevent.
 */
describe("withTransport", () => {
  test("picking Solarman moves an untouched port to 8899", () => {
    const next = withTransport(blankDraft("G"), "solarman-v5");
    expect(next.modbus.transport).toBe("solarman-v5");
    expect(next.modbus.port).toBe(8899);
  });

  test("picking a Modbus framing back moves the port back to 502", () => {
    const solarman = withTransport(blankDraft("G"), "solarman-v5");
    expect(withTransport(solarman, "tcp").modbus.port).toBe(502);
    expect(withTransport(solarman, "rtu-over-tcp").modbus.port).toBe(502);
  });

  test("a hand-typed port survives the switch, in both directions", () => {
    const draft = blankDraft("G");
    draft.modbus.port = 5020;
    const solarman = withTransport(draft, "solarman-v5");
    expect(solarman.modbus.port).toBe(5020);
    expect(withTransport(solarman, "tcp").modbus.port).toBe(5020);
  });

  // The two Modbus framings share a default, so moving between them is not a
  // port change at all — and must not become one via the Solarman default.
  test("tcp and rtu-over-tcp leave the port alone in either direction", () => {
    const draft = blankDraft("G");
    expect(withTransport(draft, "rtu-over-tcp").modbus.port).toBe(502);
    expect(withTransport(withTransport(draft, "rtu-over-tcp"), "tcp").modbus.port).toBe(502);
  });

  test("re-picking the framing already chosen changes nothing", () => {
    const draft = blankDraft("G");
    draft.modbus.port = 8899;
    expect(withTransport(draft, "tcp").modbus.port).toBe(8899);
  });

  test("it is pure — the draft handed in is not mutated", () => {
    const draft = blankDraft("G");
    withTransport(draft, "solarman-v5");
    expect(draft.modbus.transport).toBe("tcp");
    expect(draft.modbus.port).toBe(502);
  });

  test("everything else on the draft rides across untouched", () => {
    const draft = blankDraft("Keller");
    draft.modbus.host = "10.0.0.9";
    draft.mqtt.brokerUrl = "mqtt://b:1883";
    const next = withTransport(draft, "solarman-v5");
    expect(next.name).toBe("Keller");
    expect(next.modbus.host).toBe("10.0.0.9");
    expect(next.mqtt.brokerUrl).toBe("mqtt://b:1883");
  });
});

describe("connectionParamsOf — the logger serial", () => {
  test("rides along once it is known", () => {
    const draft = withTransport(blankDraft("G"), "solarman-v5");
    draft.modbus.host = "10.0.0.9";
    draft.modbus.loggerSerial = 1234567890;
    expect(connectionParamsOf(draft)).toEqual({
      kind: "modbus",
      params: {
        host: "10.0.0.9",
        port: 8899,
        transport: "solarman-v5",
        timeoutMs: 2000,
        pollIntervalMs: 1000,
        loggerSerial: 1234567890,
      },
    });
  });

  // The server discovers the serial during the probe, so the field is optional
  // and is normally empty when the body is built. An emptied number input reads
  // back as undefined or as NaN depending on the browser, and neither is a
  // number the route will take — ABSENT is the only truthful spelling of "not
  // known yet", and it is what lets the server go and find out.
  test.each([
    ["never filled in", undefined],
    ["emptied to NaN by the number input", Number.NaN],
    ["zero, which no logger stick has", 0],
  ])("is absent when it is %s", (_label, value) => {
    const draft = withTransport(blankDraft("G"), "solarman-v5");
    draft.modbus.host = "10.0.0.9";
    draft.modbus.loggerSerial = value as number | undefined;
    expect(connectionParamsOf(draft)?.params).not.toHaveProperty("loggerSerial");
  });

  test("a serial typed under a non-Solarman framing is still sent — the server decides", () => {
    const draft = blankDraft("G");
    draft.modbus.host = "10.0.0.9";
    draft.modbus.loggerSerial = 42;
    expect(connectionParamsOf(draft)?.params).toMatchObject({ loggerSerial: 42 });
  });
});
