import { describe, expect, test } from "bun:test";

import { type Dial, probeEndpoint } from "./reachability";

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

describe("probeEndpoint", () => {
  test("an open port is reachable, with the round trip it took", async () => {
    dialing.length = 0;
    const result = await probeEndpoint(
      { host: " 10.0.0.5 ", port: 502, timeoutMs: 2000 },
      dialer("open"),
    );
    expect(result.ok).toBe(true);
    expect(result.ms).toBeGreaterThanOrEqual(0);
    expect(dialing).toEqual([{ host: "10.0.0.5", port: 502, timeoutMs: 2000 }]);
  });

  test("a refused or timed-out port is unreachable, naming the reason", async () => {
    const result = await probeEndpoint(
      { host: "10.0.0.9", port: 502, timeoutMs: 500 },
      dialer(new Error("ECONNREFUSED")),
    );
    expect(result).toMatchObject({ ok: false, error: "ECONNREFUSED" });
    expect(result.ms).toBeGreaterThanOrEqual(0);
  });

  test.each([
    ["a blank host", { host: " ", port: 502 }],
    ["port 0", { host: "h", port: 0 }],
    ["a port past 65535", { host: "h", port: 70000 }],
    ["a non-object", "nope"],
  ])("%s is refused before anything dials", async (_label, body) => {
    dialing.length = 0;
    await expect(probeEndpoint(body, dialer("open"))).rejects.toThrow();
    expect(dialing).toEqual([]);
  });

  test("the timeout defaults to the connection's own default when unstated", async () => {
    dialing.length = 0;
    await probeEndpoint({ host: "h", port: 502 }, dialer("open"));
    expect(dialing[0]?.timeoutMs).toBe(2000);
  });
});
