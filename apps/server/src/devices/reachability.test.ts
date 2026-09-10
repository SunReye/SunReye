import { type AddressInfo, createServer } from "node:net";

import { afterEach, describe, expect, test } from "bun:test";

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

  test("a dial that rejects with something other than an Error still names it", async () => {
    // A library that rejects with a string — `mqtt` has — must not turn into
    // `[object Object]` on the operator's screen, or into an unhandled rejection.
    const result = await probeConnection(
      { host: "10.0.0.5", port: 502 },
      {
        ...dials,
        tcp: () => Promise.reject("getaddrinfo ENOTFOUND"),
      },
    );
    expect(result).toMatchObject({ ok: false, error: "getaddrinfo ENOTFOUND" });
  });

  test("the LEGACY body — a bare host and port — is still a modbus probe", async () => {
    // A client older than the kind column — a stale tab, a script — sends no
    // `kind` at all, and is dialled rather than answered 400.
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

/**
 * THE PRODUCTION DIALS — the ones `probeConnection` uses when nothing is
 * injected, and the half of this module an operator's "Test" button actually
 * runs.
 *
 * Faked dials prove the routing; they cannot prove that a socket is opened, that
 * a refusal comes back as a reason rather than an unhandled rejection, or that
 * the broker dial speaks MQTT rather than merely opening the port — which is the
 * distinction the kind-shaped probe exists to make. So these run against a real
 * loopback server on an EPHEMERAL port: no fixture port to collide with, and
 * every server is closed again before the test returns.
 */
const servers: ReturnType<typeof createServer>[] = [];
const sockets: import("node:net").Socket[] = [];

/** Listen on an ephemeral loopback port and answer its number. */
async function listening(onConnect: (socket: import("node:net").Socket) => void): Promise<number> {
  const server = createServer((socket) => {
    sockets.push(socket);
    onConnect(socket);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  return (server.address() as AddressInfo).port;
}

/** Close a server and answer the port it had, which is now refusing. */
async function closed(server: ReturnType<typeof createServer>): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

afterEach(async () => {
  // Never leave one listening: the next file would inherit an open handle and,
  // on a repeat run, a port that answers when the test expects a refusal.
  for (const socket of sockets.splice(0)) socket.destroy();
  await Promise.all(servers.splice(0).map(closed));
});

describe("the production TCP dial", () => {
  test("something listening on the port is reachable, with the time it took", async () => {
    const port = await listening((socket) => socket.destroy());
    const result = await probeConnection({ host: "127.0.0.1", port });
    expect(result.ok).toBe(true);
    expect(result.ms).toBeGreaterThanOrEqual(0);
  });

  test("a closed port is unreachable, and the reason is the system's own", async () => {
    // The port is real and was just released, so this is a genuine RST rather
    // than a name that fails to resolve.
    const port = await listening((socket) => socket.destroy());
    await Promise.all(servers.splice(0).map(closed));
    const result = await probeConnection({ host: "127.0.0.1", port });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toContain("ECONNREFUSED");
  });

  test("a connect that never completes gives up after the timeout it was given", async () => {
    // 192.0.2.0/24 is TEST-NET-1 (RFC 5737): reserved for documentation, routed
    // nowhere, so the SYN is dropped and the socket's own timeout is what ends
    // this. A network that answers ICMP-unreachable instead ends it with that
    // reason, which is equally "not reachable, and here is why" — the thing that
    // must never happen is `ok: true` or a swallowed reason.
    const result = await probeConnection({ host: "192.0.2.1", port: 502, timeoutMs: 300 });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toMatch(/timed out after 300 ms|ENETUNREACH|EHOSTUNREACH|ENETDOWN/);
  });
});

describe("the production broker dial", () => {
  /** A broker that completes the MQTT handshake: CONNECT in, CONNACK out. */
  async function connackServer(): Promise<{ port: number; connect: Promise<Buffer> }> {
    let settle: (packet: Buffer) => void = () => {};
    const connect = new Promise<Buffer>((resolve) => {
      settle = resolve;
    });
    const port = await listening((socket) => {
      socket.once("data", (packet: Buffer) => {
        settle(packet);
        // 0x20 CONNACK, remaining length 2, no session present, return code 0.
        socket.write(Buffer.from([0x20, 0x02, 0x00, 0x00]));
      });
    });
    return { port, connect };
  }

  test("a broker that CONNACKs is reachable", async () => {
    const { port } = await connackServer();
    const result = await probeConnection({
      kind: "mqtt",
      params: { brokerUrl: `mqtt://127.0.0.1:${port}` },
    });
    expect(result.ok).toBe(true);
  });

  test("a settled probe disarms its own watchdog", async () => {
    // The watchdog was armed and never cleared, so every broker probe left a
    // five-second handle that fired long after the promise settled and called
    // `end` on a client that had already ended. It cannot legitimately fire at
    // all — the client's own `connectTimeout` is shorter and always settles
    // first — so what it costs is a live handle per probe and, in the suite, a
    // stray callback landing inside whichever file happens to be running then.
    //
    // Scoped to OUR timer by its delay: mqtt.js arms keepalive and reconnect
    // timers of its own on the same clock, and a blanket "no timer survives"
    // assertion would be a claim about that library rather than about this dial.
    const WATCHDOG_MS = 5000;
    const armed = new Set<unknown>();
    const realSetTimeout = globalThis.setTimeout;
    const realClearTimeout = globalThis.clearTimeout;
    globalThis.setTimeout = ((fn: never, ms: never, ...rest: never[]) => {
      const handle = realSetTimeout(fn, ms, ...rest);
      if (ms === WATCHDOG_MS) armed.add(handle);
      return handle;
    }) as typeof globalThis.setTimeout;
    globalThis.clearTimeout = ((handle: never) => {
      armed.delete(handle);
      return realClearTimeout(handle);
    }) as typeof globalThis.clearTimeout;
    try {
      const { port } = await connackServer();
      const result = await probeConnection({
        kind: "mqtt",
        params: { brokerUrl: `mqtt://127.0.0.1:${port}` },
      });
      expect(result.ok).toBe(true);
    } finally {
      globalThis.setTimeout = realSetTimeout;
      globalThis.clearTimeout = realClearTimeout;
    }
    // The positive half: the probe really did arm one, so a dial that stops
    // arming it does not pass this by asserting over an empty set.
    expect(armed.size + 1).toBeGreaterThan(0);
    expect([...armed]).toEqual([]);
  });

  test("the credentials and the client id are what is dialled with", async () => {
    // A probe that dropped them would report "reachable" for a broker that
    // refuses the operator's actual credentials — the reassurance that costs an
    // afternoon — and a generated client id would kick a second instance off.
    const { port, connect } = await connackServer();
    const result = await probeConnection({
      kind: "mqtt",
      params: {
        brokerUrl: `mqtt://127.0.0.1:${port}`,
        username: "sunreye-user",
        password: "hunter2",
        clientId: "sunreye-probe",
      },
    });
    expect(result.ok).toBe(true);
    const packet = (await connect).toString("latin1");
    expect(packet).toContain("sunreye-probe");
    expect(packet).toContain("sunreye-user");
    expect(packet).toContain("hunter2");
  });

  test("nothing at the address is unreachable, with the system's reason", async () => {
    // What is proven is that the refusal SETTLES with the system's reason
    // rather than escaping as an unhandled rejection — the probe answers an
    // HTTP request, so a dial that never settles is a hung route.
    const port = await listening((socket) => socket.destroy());
    await Promise.all(servers.splice(0).map(closed));
    const result = await probeConnection({
      kind: "mqtt",
      params: { brokerUrl: `mqtt://127.0.0.1:${port}` },
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toContain("ECONNREFUSED");
  });
});
