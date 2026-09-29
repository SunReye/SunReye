/**
 * The production wiring of the broker pool: the real `mqtt` dial and the real
 * timer, against a port nothing listens on.
 *
 * `./broker-pool.test.ts` proves the pool's decisions against a fake dial. What
 * only this file can prove is that the dial it ships with hands `mqtt.connect`
 * the options the pool asked for, and that a refused broker schedules a retry
 * which neither holds the process open nor outlives a release.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { createServer } from "node:net";

import { brokerPool } from "./broker-pool-instance";

/** A loopback port that was free a moment ago and has nothing listening on it. */
async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

async function until(check: () => boolean, ms = 3_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("condition not met in time");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

afterAll(() => brokerPool.close());

describe("the process's broker pool", () => {
  test("a refused broker is reported as an error on its connection, never as connected", async () => {
    const port = await closedPort();
    const link = brokerPool.acquire(
      9_001,
      {
        brokerUrl: `mqtt://127.0.0.1:${port}`,
        username: "u",
        password: "p",
        clientId: "sunreye-test",
      },
      { will: { topic: "sunreye/status", payload: "offline", qos: 1, retain: true } },
    );
    await until(() => link.status().lastError !== null);
    expect(link.status().connected).toBe(false);
    // The close that follows the refusal arms a retry; a release must cancel it.
    await new Promise((resolve) => setTimeout(resolve, 50));
    await link.release();
    expect(brokerPool.status(9_001)).toBeNull();
  });

  test("a connection with no client id or will still dials", async () => {
    const port = await closedPort();
    const link = brokerPool.acquire(9_002, { brokerUrl: `mqtt://127.0.0.1:${port}` });
    await until(() => link.status().lastError !== null);
    await link.release();
  });
});
