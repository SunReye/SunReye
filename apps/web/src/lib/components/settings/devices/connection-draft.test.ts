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
