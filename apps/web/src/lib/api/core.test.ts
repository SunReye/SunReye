/// <reference types="bun" />
import { afterEach, expect, test } from "bun:test";
import { connect, http, type Live, type Transport } from "./core.ts";

const BASE = "http://core.test/prefix/";

function sse(...events: readonly string[]): Response {
  return new Response(events.join(""), { headers: { "content-type": "text/event-stream" } });
}

function event(name: string, data: string): string {
  return `event: ${name}\ndata: ${data}\n\n`;
}

function problem(status: number, code: string): Response {
  return Response.json(
    { status, code },
    { status, headers: { "content-type": "application/problem+json" } },
  );
}

/** A test core: answers each request in turn and records its URL. */
function scripted(...responses: readonly Response[]): Transport & { readonly urls: string[] } {
  const urls: string[] = [];
  const queue = [...responses];

  return {
    base: BASE,
    urls,
    fetch: (request) => {
      urls.push(request.url);
      const next = queue.shift();

      // Past its script the core holds the request open.
      return next === undefined ? Promise.withResolvers<Response>().promise : Promise.resolve(next);
    },
  };
}

/** Collects `count` live updates, then stops the stream. */
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

test("a refused stream reports the problem code", async () => {
  expect(await updates(scripted(problem(401, "auth.required")), 1)).toEqual([
    { problem: "auth.required" },
  ]);
});

let server: ReturnType<typeof Bun.serve> | undefined;

afterEach(async () => {
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
