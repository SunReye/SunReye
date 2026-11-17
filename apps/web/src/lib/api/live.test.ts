/// <reference types="bun" />
// The live stream through `connect` (ADR 9, 21).
import { afterEach, expect, jest, setSystemTime, test } from "bun:test";
import { connect, type Live, type Transport } from "./core.ts";
import { BASE, event, problem, scripted, sse } from "./core.harness.ts";

afterEach(() => {
  setSystemTime();
});

async function updates(transport: Transport, count: number): Promise<Live[]> {
  const seen: Live[] = [];
  const { promise, resolve } = Promise.withResolvers<Live[]>();

  const stop = connect(transport).live((live) => {
    seen.push(live);

    if (seen.length === count) resolve(seen);
  });

  try {
    return await promise;
  } finally {
    stop();
  }
}

test("live values are the snapshot with each delta folded in", async () => {
  const transport = scripted(
    sse(
      event("snapshot", '{"devices":{"1":{"pv.power":1200,"grid.power":-300}}}'),
      event("delta", '{"devices":{"1":{"grid.power":-250},"2":{"load.power":80}}}'),
    ),
  );

  expect(await updates(transport, 2)).toEqual([
    { devices: { "1": { "pv.power": 1200, "grid.power": -300 } } },
    { devices: { "1": { "pv.power": 1200, "grid.power": -250 }, "2": { "load.power": 80 } } },
  ]);
  expect(transport.urls).toEqual([`${BASE}api/v1/live`]);
});

test("a stale value keeps its value and when it was last read until read again", async () => {
  const now = Date.parse("2026-11-09T12:00:00Z");
  setSystemTime(now);

  const transport = scripted(
    sse(
      event(
        "snapshot",
        '{"devices":{"1":{"grid.power":300,"pv.power":5}},"stale":{"1":{"grid.power":40}}}',
      ),
      event("delta", '{"devices":{},"stale":{"1":{"pv.power":15}}}'),
      event("delta", '{"devices":{"1":{"grid.power":300}}}'),
    ),
  );

  try {
    expect(await updates(transport, 3)).toEqual([
      {
        devices: { "1": { "grid.power": 300, "pv.power": 5 } },
        stale: { "1": { "grid.power": now - 40_000 } },
      },
      {
        devices: { "1": { "grid.power": 300, "pv.power": 5 } },
        stale: { "1": { "grid.power": now - 40_000, "pv.power": now - 15_000 } },
      },
      {
        devices: { "1": { "grid.power": 300, "pv.power": 5 } },
        stale: { "1": { "pv.power": now - 15_000 } },
      },
    ]);
  } finally {
    setSystemTime();
  }
});

test("an event split across chunks still parses", async () => {
  const text = event("snapshot", '{"devices":{"1":{"pv.power":7}}}');

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const bytes = new TextEncoder().encode(text);

      controller.enqueue(bytes.slice(0, 10));
      controller.enqueue(bytes.slice(10));
    },
  });

  expect(await updates(scripted(new Response(body)), 1)).toEqual([
    { devices: { "1": { "pv.power": 7 } } },
  ]);
});

test("a stream the core ends reconnects to a fresh snapshot", async () => {
  const transport = scripted(
    sse(event("snapshot", '{"devices":{"1":{"pv.power":1}}}')),
    sse(event("snapshot", '{"devices":{"2":{"pv.power":2}}}')),
  );

  expect(await updates(transport, 2)).toEqual([
    { devices: { "1": { "pv.power": 1 } } },
    { devices: { "2": { "pv.power": 2 } } },
  ]);
  expect(transport.urls).toHaveLength(2);
});

test("a stream that breaks after its snapshot keeps its values, marked lost, until the next", async () => {
  setSystemTime(new Date(5000));

  const broken = new ReadableStream<Uint8Array>({
    start: (c) => {
      c.enqueue(new TextEncoder().encode(event("snapshot", '{"devices":{"1":{"pv.power":1}}}')));
    },
    pull: (c) => {
      c.error(new Error("network"));
    },
  });

  expect(
    await updates(scripted(new Response(broken), sse(event("snapshot", '{"devices":{}}'))), 3),
  ).toEqual([
    { devices: { "1": { "pv.power": 1 } } },
    { devices: { "1": { "pv.power": 1 } }, lost: 5000 },
    { devices: {} },
  ]);
});

/** A stream the test feeds by hand, and a way to let its bytes through the parser. */
function held() {
  let feed!: ReadableStreamDefaultController<Uint8Array>;

  const body = new ReadableStream<Uint8Array>({
    start: (c) => {
      feed = c;
    },
  });

  return {
    response: new Response(body),
    send: (text: string) => {
      feed.enqueue(new TextEncoder().encode(text));
    },
  };
}

/** Lets queued promise jobs run: the fake clock moves no bytes through the streams. */
async function drain(rounds = 50): Promise<void> {
  if (rounds === 0) return;

  await Promise.resolve();
  await drain(rounds - 1);
}

test("a stream silent for 30 s is marked lost and reconnects; a keep-alive keeps it", async () => {
  jest.useFakeTimers();
  setSystemTime(new Date(1000));

  try {
    const silent = held();
    const seen: Live[] = [];
    const transport = scripted(silent.response, sse(event("snapshot", '{"devices":{}}')));

    const stop = connect(transport).live((live) => {
      seen.push(live);
    });

    await drain();
    silent.send(event("snapshot", '{"devices":{"1":{"pv.power":1}}}'));
    await drain();
    jest.advanceTimersByTime(20_000);
    // The core's 15 s keep-alive is a comment: no event, but proof the line is up.
    silent.send(":\n\n");
    await drain();
    jest.advanceTimersByTime(20_000);
    await drain();

    expect(seen).toEqual([{ devices: { "1": { "pv.power": 1 } } }]);

    jest.advanceTimersByTime(10_000);
    await drain();

    expect(seen.at(-1)).toEqual({ devices: { "1": { "pv.power": 1 } }, lost: 51_000 });

    jest.advanceTimersByTime(1000);
    await drain();
    stop();

    expect(seen.at(-1)).toEqual({ devices: {} });
  } finally {
    jest.useRealTimers();
  }
});

test("a refused stream reports the problem code", async () => {
  expect(await updates(scripted(problem(401, "auth.required")), 1)).toEqual([
    { problem: "auth.required" },
  ]);
});

test("a refusal that is no problem document reports its HTTP status", async () => {
  const proxy = new Response("<html>Bad Gateway</html>", {
    status: 502,
    headers: { "content-type": "text/html" },
  });

  expect(await updates(scripted(proxy), 1)).toEqual([{ problem: "http.502" }]);
});

/** A page whose visibility the test flips. */
class Page extends EventTarget {
  hidden = false;

  show(visible: boolean): void {
    this.hidden = !visible;
    this.dispatchEvent(new Event("visibilitychange"));
  }
}

test("every listener on a page shares one live request, closed when the last leaves", async () => {
  const stream = held();
  const transport = scripted(stream.response);
  const core = connect(transport);
  const first: Live[] = [];
  const late: Live[] = [];

  const stopFirst = core.live((live) => {
    first.push(live);
  });

  await drain();
  stream.send(event("snapshot", '{"devices":{"1":{"pv.power":1}}}'));
  stream.send(event("delta", '{"devices":{"1":{"grid.power":2}}}'));
  await drain();

  const stopLate = core.live((live) => {
    late.push(live);
  });

  // A late listener gets the latest values at once, as its own snapshot would have.
  expect(late).toEqual([]);
  await drain();
  expect(late).toEqual([{ devices: { "1": { "pv.power": 1, "grid.power": 2 } } }]);

  stream.send(event("delta", '{"devices":{"1":{"pv.power":3}}}'));
  await drain();

  const both = { devices: { "1": { "pv.power": 3, "grid.power": 2 } } };
  expect(first.at(-1)).toEqual(both);
  expect(late.at(-1)).toEqual(both);
  expect(transport.requests).toHaveLength(1);

  stopFirst();
  expect(transport.open()).toBe(1);
  stopLate();
  expect(transport.open()).toBe(0);
});

test("a hidden page holds no live request and reconnects when shown", async () => {
  const page = new Page();
  page.hidden = true;
  const transport = scripted(sse(event("snapshot", '{"devices":{"1":{"pv.power":1}}}')));
  const seen: Live[] = [];

  const stop = connect(transport, page).live((live) => {
    seen.push(live);
  });

  await drain();
  expect(transport.requests).toHaveLength(0);

  page.show(true);
  await drain();
  expect(seen).toEqual([{ devices: { "1": { "pv.power": 1 } } }]);
  // The core ended the scripted stream; the reconnect is held open.
  expect(transport.requests).toHaveLength(2);

  page.show(false);
  await drain();
  expect(transport.open()).toBe(0);

  page.show(true);
  await drain();
  expect(transport.requests).toHaveLength(3);
  expect(transport.open()).toBe(1);
  // Hiding is no loss: no value went out marked lost.
  expect(seen.filter((live) => "lost" in live)).toEqual([]);

  stop();
  expect(transport.open()).toBe(0);
});
