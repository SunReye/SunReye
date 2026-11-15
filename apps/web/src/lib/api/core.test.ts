/// <reference types="bun" />
import { afterEach, expect, jest, setSystemTime, test } from "bun:test";
import { connect, http, type Live, type Transport } from "./core.ts";
import { BASE, event, problem, scripted, sse } from "./core.harness.ts";

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

let server: ReturnType<typeof Bun.serve> | undefined;

afterEach(async () => {
  setSystemTime();
  await server?.stop(true);
});

test("history asks the core under its prefix for a series over a range", async () => {
  const asked: string[] = [];
  server = Bun.serve({
    port: 0,
    fetch: (request) => {
      const url = new URL(request.url);
      asked.push(url.pathname + url.search);

      return Response.json({
        tier: "bucket",
        width: 60,
        points: [{ start: "2026-11-09T00:00:00Z", end: "2026-11-09T00:01:00Z", mean: 412.5 }],
      });
    },
  });
  const core = connect(http(`http://127.0.0.1:${server.port}/prefix/`));

  const history = await core.history(
    1,
    "pv.power",
    new Date("2026-11-09T00:00:00Z"),
    new Date("2026-11-09T12:00:00Z"),
  );

  expect(asked).toEqual([
    "/prefix/api/v1/devices/1/history?series=pv.power&from=2026-11-09T00%3A00%3A00.000Z&to=2026-11-09T12%3A00%3A00.000Z",
  ]);
  expect(history).toEqual({
    tier: "bucket",
    width: 60,
    points: [{ start: "2026-11-09T00:00:00Z", end: "2026-11-09T00:01:00Z", mean: 412.5 }],
  });
});

test("a refused history read reports the problem code", async () => {
  const core = connect(scripted(problem(422, "history.range")));

  const history = await core.history(1, "pv.power", new Date(0), new Date(0));

  expect(history).toEqual({ problem: "history.range" });
});

test("a refusal that is no problem document reports its HTTP status", async () => {
  const proxy = new Response("<html>Bad Gateway</html>", {
    status: 502,
    headers: { "content-type": "text/html" },
  });

  expect(await updates(scripted(proxy), 1)).toEqual([{ problem: "http.502" }]);
});

/** A test core that records each request with its method and body. */
