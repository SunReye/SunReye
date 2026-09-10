/**
 * THE POOL'S LIFECYCLE, against a dial that never touches a socket.
 *
 * Every behaviour here is one a live plant can hit — a broker that refuses, a
 * broker whose URL is edited on the settings page, two integrations on one
 * broker, a broker row deleted while its client is open — and none of them is
 * observable from a config read, which is the whole point of #221.
 */

import { EventEmitter } from "node:events";
import { describe, expect, test } from "bun:test";

import { type BrokerClient, type BrokerConnectOptions, createBrokerPool } from "./broker-pool";

/** Stands in for an `mqtt` client: records what it was told, echoes nothing. */
class FakeClient extends EventEmitter implements BrokerClient {
  subscriptions: string[][] = [];
  published: { topic: string; payload: string }[] = [];
  ended = 0;
  subscribeError: Error | null = null;

  subscribe(topics: string[], callback?: (error?: Error | null) => void): void {
    if (this.subscribeError) {
      callback?.(this.subscribeError);
      return;
    }
    this.subscriptions.push(topics);
    callback?.(null);
  }

  publish(topic: string, payload: string, _options?: unknown, callback?: () => void): void {
    this.published.push({ topic, payload });
    callback?.();
  }

  async endAsync(): Promise<void> {
    this.ended += 1;
  }
}

interface FakeTimer {
  ms: number;
  run: () => void;
  cancelled: boolean;
}

const broker = (over: Partial<{ brokerUrl: string; username: string; clientId: string }> = {}) => ({
  brokerUrl: "mqtt://hass.test:1883",
  ...over,
});

function harness() {
  const dials: { url: string; options: BrokerConnectOptions }[] = [];
  const clients: FakeClient[] = [];
  const timers: FakeTimer[] = [];
  let clock = Date.parse("2026-09-10T08:00:00.000Z");
  const logged: { level: string; template: string }[] = [];
  const pool = createBrokerPool({
    dial: (url, options) => {
      dials.push({ url, options });
      const client = new FakeClient();
      clients.push(client);
      return client;
    },
    schedule: (run, ms) => {
      const timer: FakeTimer = { ms, run, cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
    now: () => new Date(clock),
    logger: {
      info: (template) => logged.push({ level: "info", template }),
      warn: (template) => logged.push({ level: "warn", template }),
      error: (template) => logged.push({ level: "error", template }),
    },
  });
  return {
    pool,
    dials,
    clients,
    timers,
    logged,
    /** The client of the most recent dial. */
    client: () => {
      const last = clients.at(-1);
      if (!last) throw new Error("nothing was dialled");
      return last;
    },
    /** Run the pending retry, as the event loop would. */
    fireRetry: () => {
      const due = timers.filter((timer) => !timer.cancelled).at(-1);
      if (!due) throw new Error("no retry was scheduled");
      due.cancelled = true;
      due.run();
    },
    /** A failed dial: the library reports the error, then closes. */
    refuse: (reason = "ECONNREFUSED") => {
      const client = clients.at(-1);
      client?.emit("error", new Error(reason));
      client?.emit("close");
    },
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe("opening", () => {
  test("dials once, with the connection's credentials and no library retry", () => {
    const h = harness();
    h.pool.acquire(7, broker({ username: "mqtt", clientId: "sunreye" }));
    expect(h.dials).toHaveLength(1);
    expect(h.dials[0]?.url).toBe("mqtt://hass.test:1883");
    expect(h.dials[0]?.options.username).toBe("mqtt");
    expect(h.dials[0]?.options.clientId).toBe("sunreye");
    // The pool owns the backoff (see below), so the library must not run a
    // second, invisible retry loop of its own against the same broker.
    expect(h.dials[0]?.options.reconnectPeriod).toBe(0);
  });

  test("status is OBSERVED, not derived from the row being present", () => {
    const h = harness();
    const link = h.pool.acquire(7, broker());
    expect(link.status().connected).toBe(false);

    h.advance(1500);
    h.client().emit("connect");
    expect(link.status()).toEqual({
      connected: true,
      lastError: null,
      lastErrorAt: null,
      lastConnectedAt: "2026-09-10T08:00:01.500Z",
    });
  });

  test("a subscriber's topics go out on connect, and again on every reconnect", () => {
    const h = harness();
    const link = h.pool.acquire(7, broker());
    const connects: number[] = [];
    link.subscribe({ topics: ["evcc/#"], onConnect: () => connects.push(1) });
    expect(h.client().subscriptions).toEqual([]);

    h.client().emit("connect");
    expect(h.client().subscriptions).toEqual([["evcc/#"]]);
    h.client().emit("close");
    h.client().emit("connect");
    // A broker restart drops every subscription; re-subscribing is what makes a
    // reconnect a recovery rather than a permanently silent client.
    expect(h.client().subscriptions).toEqual([["evcc/#"], ["evcc/#"]]);
    expect(connects).toHaveLength(2);
  });

  test("a refused subscription reaches the subscriber that asked for it", () => {
    const h = harness();
    const link = h.pool.acquire(7, broker());
    const refusal = new Error("not authorized");
    const errors: unknown[] = [];
    h.client().subscribeError = refusal;
    link.subscribe({ topics: ["evcc/#"], onSubscribeError: (error) => errors.push(error) });
    h.client().emit("connect");
    expect(errors).toEqual([refusal]);
  });

  test("a subscriber joining an already-connected client subscribes at once", () => {
    const h = harness();
    h.pool.acquire(7, broker()).subscribe({ topics: ["sunreye/#"] });
    h.client().emit("connect");

    const late = h.pool.acquire(7, broker());
    const connects: number[] = [];
    late.subscribe({ topics: ["evcc/#"], onConnect: () => connects.push(1) });
    // Otherwise the second integration on a shared broker waits for a reconnect
    // that may never come, and reads nothing while its status says "connected".
    expect(h.client().subscriptions).toEqual([["sunreye/#"], ["evcc/#"]]);
    expect(connects).toEqual([1]);
  });
});

describe("sharing", () => {
  test("two integrations on ONE broker share ONE client", () => {
    const h = harness();
    const ingest = h.pool.acquire(7, broker());
    const exporter = h.pool.acquire(7, broker());
    expect(h.dials).toHaveLength(1);

    const seen: string[] = [];
    ingest.subscribe({ topics: ["evcc/#"], onMessage: (topic) => seen.push(`ingest:${topic}`) });
    exporter.subscribe({
      topics: ["sunreye/#"],
      onMessage: (topic) => seen.push(`export:${topic}`),
    });
    h.client().emit("connect");
    h.client().emit("message", "evcc/loadpoints/1/mode", Buffer.from("pv"));
    // Both hear everything; each filters its own tree, exactly as it does today
    // with a client of its own.
    expect(seen).toEqual(["ingest:evcc/loadpoints/1/mode", "export:evcc/loadpoints/1/mode"]);
  });

  test("two BROKERS are two clients", () => {
    const h = harness();
    h.pool.acquire(7, broker());
    h.pool.acquire(8, broker({ brokerUrl: "mqtt://other.test:1883" }));
    expect(h.dials.map((dial) => dial.url)).toEqual([
      "mqtt://hass.test:1883",
      "mqtt://other.test:1883",
    ]);
  });

  test("releasing ONE holder leaves the client up for the other", async () => {
    const h = harness();
    const ingest = h.pool.acquire(7, broker());
    const exporter = h.pool.acquire(7, broker());
    await ingest.release();
    expect(h.client().ended).toBe(0);

    await exporter.release();
    expect(h.client().ended).toBe(1);
    expect(h.pool.status(7)).toBeNull();
  });

  test("a released subscriber stops hearing messages", async () => {
    const h = harness();
    const ingest = h.pool.acquire(7, broker());
    h.pool.acquire(7, broker());
    const seen: string[] = [];
    ingest.subscribe({ topics: ["evcc/#"], onMessage: (topic) => seen.push(topic) });
    h.client().emit("connect");
    await ingest.release();
    h.client().emit("message", "evcc/x", Buffer.from(""));
    expect(seen).toEqual([]);
  });
});

describe("re-opening", () => {
  test("an UNCHANGED patch is a no-op — no re-dial, no dropped subscription", () => {
    const h = harness();
    const link = h.pool.acquire(7, broker({ username: "mqtt" }));
    link.subscribe({ topics: ["evcc/#"] });
    h.client().emit("connect");

    h.pool.acquire(7, broker({ username: "mqtt" }));
    // A re-dial per settings save would drop every retained subscription and
    // flap the LWT on a broker the operator never touched.
    expect(h.dials).toHaveLength(1);
    expect(h.client().ended).toBe(0);
  });

  test("a CHANGED param re-dials, and carries the subscribers across", async () => {
    const h = harness();
    const link = h.pool.acquire(7, broker());
    const connects: number[] = [];
    link.subscribe({ topics: ["evcc/#"], onConnect: () => connects.push(1) });
    h.client().emit("connect");
    const first = h.client();

    h.pool.acquire(7, broker({ brokerUrl: "mqtt://moved.test:1883" }));
    await Bun.sleep(0);
    expect(h.dials).toHaveLength(2);
    expect(first.ended).toBe(1);
    expect(link.status().connected).toBe(false);
    // The holder that never asked for the move sees the new endpoint too:
    // there is one connection, not one per holder.
    expect(link.brokerUrl).toBe("mqtt://moved.test:1883");

    h.client().emit("connect");
    // The consumer did not re-register anything: the CONNECTION re-opened, and
    // what was attached to it came along.
    expect(h.client().subscriptions).toEqual([["evcc/#"]]);
    expect(connects).toHaveLength(2);
  });

  test("`update` re-points the connection without taking a second holder", async () => {
    const h = harness();
    const link = h.pool.acquire(7, broker());
    link.subscribe({ topics: ["evcc/#"] });
    h.client().emit("connect");

    link.update(broker());
    expect(h.dials).toHaveLength(1);

    link.update(broker({ brokerUrl: "mqtt://moved.test:1883" }));
    await Bun.sleep(0);
    expect(h.dials).toHaveLength(2);
    // Still ONE holder: releasing it must still close the client, or the tier
    // re-applying a row every pass would make it unclosable.
    await link.release();
    expect(h.pool.status(7)).toBeNull();
  });

  test("`update` on a released link does nothing", async () => {
    const h = harness();
    const link = h.pool.acquire(7, broker());
    await link.release();
    link.update(broker({ brokerUrl: "mqtt://moved.test:1883" }));
    // A settle racing a delete must not resurrect a connection that is gone.
    expect(h.dials).toHaveLength(1);
    expect(h.pool.status(7)).toBeNull();
  });

  test("a last will declared later re-dials; the same will again does not", async () => {
    const h = harness();
    const will = {
      topic: "sunreye/plant/status",
      payload: "offline",
      qos: 0 as const,
      retain: true,
    };
    h.pool.acquire(7, broker());
    expect(h.dials[0]?.options.will).toBeUndefined();

    // The Home Assistant export joins the broker the ingest already opened. An
    // LWT is a CONNECT-time property, so declaring one is a re-dial or it is
    // nothing at all.
    h.pool.acquire(7, broker(), { will });
    await Bun.sleep(0);
    expect(h.dials).toHaveLength(2);
    expect(h.dials[1]?.options.will).toEqual(will);

    h.pool.acquire(7, broker(), { will });
    expect(h.dials).toHaveLength(2);
    // A holder that declares nothing must not strip the will the export set.
    h.pool.acquire(7, broker());
    expect(h.dials).toHaveLength(2);
  });
});

describe("a broker that will not answer", () => {
  test("the status carries the error and when it happened", () => {
    const h = harness();
    const link = h.pool.acquire(7, broker());
    h.advance(2000);
    h.refuse("connect ECONNREFUSED 10.0.0.9:1883");
    expect(link.status()).toEqual({
      connected: false,
      lastError: "connect ECONNREFUSED 10.0.0.9:1883",
      lastErrorAt: "2026-09-10T08:00:02.000Z",
      lastConnectedAt: null,
    });
  });

  test("the retry delay GROWS, and is capped", () => {
    const h = harness();
    h.pool.acquire(7, broker());
    const delays: number[] = [];
    for (let attempt = 0; attempt < 8; attempt += 1) {
      h.refuse();
      delays.push(h.timers.at(-1)?.ms ?? -1);
      h.fireRetry();
    }
    // A live broker in someone's house: a fixed 1 s retry is a request storm
    // against a machine that is already refusing, and it never backs off.
    expect(delays).toEqual([1000, 2000, 4000, 8000, 16_000, 32_000, 60_000, 60_000]);
    expect(h.dials).toHaveLength(9);
  });

  test("a successful connect resets the backoff and clears the error", () => {
    const h = harness();
    const link = h.pool.acquire(7, broker());
    h.refuse();
    h.fireRetry();
    h.refuse();
    h.fireRetry();
    expect(h.timers.at(-1)?.ms).toBe(2000);

    h.client().emit("connect");
    expect(link.status().lastError).toBeNull();
    h.client().emit("close");
    expect(h.timers.at(-1)?.ms).toBe(1000);
  });

  test("a DELIBERATE close schedules nothing", async () => {
    const h = harness();
    const link = h.pool.acquire(7, broker());
    h.client().emit("connect");
    const client = h.client();
    await link.release();
    client.emit("close");
    // The row is gone (or the process is shutting down). A retry here would
    // dial a broker nothing is bound to, forever.
    expect(h.timers.filter((timer) => !timer.cancelled)).toEqual([]);
  });

  test("releasing mid-backoff cancels the pending retry", async () => {
    const h = harness();
    const link = h.pool.acquire(7, broker());
    h.refuse();
    expect(h.timers.filter((timer) => !timer.cancelled)).toHaveLength(1);
    await link.release();
    expect(h.timers.filter((timer) => !timer.cancelled)).toEqual([]);
  });
});

describe("publishing", () => {
  test("goes out on the connection's client", () => {
    const h = harness();
    const link = h.pool.acquire(7, broker());
    h.client().emit("connect");
    link.publish("evcc/loadpoints/1/mode/set", "pv");
    expect(h.client().published).toEqual([{ topic: "evcc/loadpoints/1/mode/set", payload: "pv" }]);
  });

  test("a link whose client is being re-dialled publishes onto the NEW one", async () => {
    const h = harness();
    const link = h.pool.acquire(7, broker());
    h.pool.acquire(7, broker({ brokerUrl: "mqtt://moved.test:1883" }));
    await Bun.sleep(0);
    link.publish("x", "1");
    expect(h.clients[0]?.published).toEqual([]);
    expect(h.clients[1]?.published).toEqual([{ topic: "x", payload: "1" }]);
  });
});

describe("the pool as a whole", () => {
  test("status for a connection it holds nothing for is null, not a fake 'down'", () => {
    const h = harness();
    expect(h.pool.status(99)).toBeNull();
  });

  test("close releases every client it holds", async () => {
    const h = harness();
    h.pool.acquire(7, broker());
    h.pool.acquire(8, broker({ brokerUrl: "mqtt://other.test:1883" }));
    await h.pool.close();
    expect(h.clients.map((client) => client.ended)).toEqual([1, 1]);
    expect(h.pool.status(7)).toBeNull();
  });
});
