import { describe, expect, test } from "bun:test";

import { type BrokerDial, type Dial, probeConnection } from "./reachability";

/**
 * The gateway probe is a TCP connect, nothing more — no Modbus, no profile.
 * What is proven here: the body is validated before anything dials, the dial
 * gets the address and timeout it was given, and the two outcomes (open, or a
 * reason) come back with the time they took. The socket itself is the dial's
 * business and is faked.
 */
const dialing: Array<{ host: string; port: number; timeoutMs: number }> = [];
const dialer =
  (outcome: "open" | Error): Dial =>
  async (host, port, timeoutMs) => {
    dialing.push({ host, port, timeoutMs });
    if (outcome instanceof Error) throw outcome;
  };

/**
 * The KIND-shaped probe (#217).
 *
 * The dialog can add a broker now, and "is it there" means something different
 * per kind: a Modbus gateway answers a TCP connect, a broker answers an MQTT
 * CONNECT. Probing a broker with a bare TCP connect would report every
 * password-protected broker as reachable, which is the reassurance that costs an
 * operator an afternoon.
 */
const connecting: string[] = [];
const brokerDialer =
  (outcome: "open" | Error): BrokerDial =>
  async (params) => {
    connecting.push(params.brokerUrl);
    if (outcome instanceof Error) throw outcome;
  };

describe("probeConnection", () => {
  const dials = { tcp: dialer("open"), broker: brokerDialer("open") };

  test("a modbus body dials TCP with its host and port", async () => {
    dialing.length = 0;
    connecting.length = 0;
    const result = await probeConnection(
      { kind: "modbus", params: { host: "10.0.0.5", port: 8899, timeoutMs: 1500 } },
      dials,
    );
    expect(result.ok).toBe(true);
    expect(dialing).toEqual([{ host: "10.0.0.5", port: 8899, timeoutMs: 1500 }]);
    expect(connecting).toEqual([]);
  });

  test("an mqtt body CONNECTS to the broker rather than opening its port", async () => {
    dialing.length = 0;
    connecting.length = 0;
    const result = await probeConnection(
      { kind: "mqtt", params: { brokerUrl: "mqtt://hass.lan:1883", username: "u" } },
      dials,
    );
    expect(result.ok).toBe(true);
    expect(connecting).toEqual(["mqtt://hass.lan:1883"]);
    expect(dialing).toEqual([]);
  });

  test("a broker that refuses the credentials is unreachable, naming the reason", async () => {
    const result = await probeConnection(
      { kind: "mqtt", params: { brokerUrl: "mqtt://hass.lan:1883" } },
      { ...dials, broker: brokerDialer(new Error("Not authorized")) },
    );
    expect(result).toMatchObject({ ok: false, error: "Not authorized" });
  });

  test("the LEGACY body — a bare host and port — is still a modbus probe", async () => {
    // The add-connection dialog is the web half of #217 and ships separately, so
    // the route has to keep answering the body the current dialog sends.
    dialing.length = 0;
    const result = await probeConnection({ host: "10.0.0.5", port: 502 }, dials);
    expect(result.ok).toBe(true);
    expect(dialing).toEqual([{ host: "10.0.0.5", port: 502, timeoutMs: 2000 }]);
  });

  test.each([
    ["an unknown kind", { kind: "http", params: { host: "h", port: 80 } }],
    ["a modbus body with no host", { kind: "modbus", params: { port: 502 } }],
    ["an mqtt body with no broker URL", { kind: "mqtt", params: {} }],
    ["broker params under the modbus kind", { kind: "modbus", params: { brokerUrl: "mqtt://x" } }],
    ["a non-object", "nope"],
  ])("%s is refused before anything dials", async (_label, body) => {
    dialing.length = 0;
    connecting.length = 0;
    await expect(probeConnection(body, dials)).rejects.toThrow();
    expect(dialing).toEqual([]);
    expect(connecting).toEqual([]);
  });
});
