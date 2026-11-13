/// <reference types="bun" />
// A fake core for the smoothness journeys: the built SPA and every read its screens make,
// answered from the synthetic plant. No database, no inverter.

import { join } from "node:path";
import { fixed } from "./fixtures.ts";
import { plantAt } from "./plant.ts";
import { costs, forecasts, history, statistics, type Plant } from "./series.ts";

const PERIODS = ["day", "week", "month"] as const;

type Query = Readonly<URLSearchParams>;

const periodOf = (q: Query) => PERIODS.find((p) => p === q.get("period")) ?? "day";

const seriesOf = (q: Query) => q.get("series") ?? "";

const spanOf = (q: Query) => ({
  from: Date.parse(q.get("from") ?? ""),
  to: Date.parse(q.get("to") ?? ""),
});

/** A device's reads by kind: its series' history, statistics and forecasts, a setting's value. */
function deviceReads(plant: Plant) {
  return {
    history: (device: number, q: Query) => history(plant, device, seriesOf(q), spanOf(q)),
    statistics: (device: number, q: Query) =>
      statistics(plant, device, seriesOf(q), periodOf(q), spanOf(q)),
    forecasts: (device: number, q: Query) => forecasts(plant, device, seriesOf(q), spanOf(q)),
    settings: () => ({ value: 120 }),
  };
}

function missing(pathname: string): Response {
  process.stderr.write(`fake core: no answer for ${pathname}\n`);

  return Response.json(
    { status: 404, code: "not.found" },
    { status: 404, headers: { "content-type": "application/problem+json" } },
  );
}

const DEVICE = /^\/api\/v1\/devices\/(\d+)\/(\w+)/u;

/** A device read; a path the fake does not know is logged and refused. */
function deviceAnswer(plant: Plant, pathname: string, q: Query): Response {
  const [, id, kind = ""] = DEVICE.exec(pathname) ?? [];

  const reads: Readonly<Record<string, ((device: number, q: Query) => object) | undefined>> =
    deviceReads(plant);

  const read = reads[kind];

  return read ? Response.json(read(Number(id), q)) : missing(pathname);
}

const encoder = new TextEncoder();

/** The live stream: a snapshot, then every value each second. */
function live(plant: Plant): Response {
  let timer: ReturnType<typeof setInterval> | undefined;

  const frame = (name: string) => {
    const devices = plantAt(Date.now(), plant.offset);

    return encoder.encode(`event: ${name}\ndata: ${JSON.stringify({ devices })}\n\n`);
  };

  return new Response(
    new ReadableStream({
      start: (controller) => {
        controller.enqueue(frame("snapshot"));
        timer = setInterval(() => {
          controller.enqueue(frame("change"));
        }, 1000);
      },
      cancel: () => {
        clearInterval(timer);
      },
    }),
    { headers: { "content-type": "text/event-stream", "cache-control": "no-store" } },
  );
}

/** Every path the fake answers whatever the device. */
function routes(plant: Plant) {
  const reads = Object.entries(fixed(plant.zone, plant.start)).map(
    ([path, answer]: readonly [string, () => object]) =>
      [path, () => Response.json(answer())] as const,
  );

  return {
    ...Object.fromEntries(reads),
    "/api/v1/session": () => new Response(null, { status: 204 }),
    "/api/v1/live": () => live(plant),
    "/api/v1/costs": (q: Query) => Response.json(costs(plant, spanOf(q))),
  };
}

function api(plant: Plant, method: string, pathname: string, q: Query): Response {
  // Writes succeed; the journeys only wait for an answer.
  if (method !== "GET") return Response.json({ outcome: "verified" });

  const answers: Readonly<Record<string, ((q: Query) => Response) | undefined>> = routes(plant);

  return answers[pathname]?.(q) ?? deviceAnswer(plant, pathname, q);
}

/** The built file at `pathname`; any other path is the SPA's page. */
async function asset(build: string, pathname: string): Promise<Response> {
  const file = Bun.file(join(build, pathname));

  return new Response((await file.exists()) ? file : Bun.file(join(build, "index.html")));
}

/** Serves `build` and the API on `port`; logs each API path it does not know. */
export function serve(build: string, port: number, plant: Plant) {
  return Bun.serve({
    port,
    hostname: "127.0.0.1",
    idleTimeout: 0,
    fetch: (request) => {
      const url = new URL(request.url);

      if (url.pathname.startsWith("/api/"))
        return api(plant, request.method, url.pathname, url.searchParams);

      return asset(build, url.pathname === "/" ? "index.html" : url.pathname);
    },
  });
}
