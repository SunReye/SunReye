/// <reference types="bun" />
import type { Problem, Transport } from "./core.ts";

export const BASE = "http://core.test/prefix/";

export function sse(...events: readonly string[]): Response {
  return new Response(events.join(""), { headers: { "content-type": "text/event-stream" } });
}

export function event(name: string, data: string): string {
  return `event: ${name}\ndata: ${data}\n\n`;
}

export function problem(status: number, code: string): Response {
  return Response.json(
    { status, code },
    { status, headers: { "content-type": "application/problem+json" } },
  );
}

/** A test core: answers each request in turn and records its URL and how many are not aborted. */
export function scripted(...responses: readonly Response[]): Transport & {
  readonly urls: string[];
  readonly requests: readonly Request[];
  readonly open: () => number;
} {
  const urls: string[] = [];
  const requests: Request[] = [];
  const queue = [...responses];

  return {
    base: BASE,
    urls,
    requests,
    open: () => requests.filter((request) => !request.signal.aborted).length,
    fetch: (request) => {
      urls.push(request.url);
      requests.push(request);
      const next = queue.shift();

      // Past its script the core holds the request open.
      return next === undefined ? Promise.withResolvers<Response>().promise : Promise.resolve(next);
    },
  };
}

/** A screen's API requests by path, `/api/v1/` cut off, the live stream included. */
export function tally(urls: readonly string[]) {
  const counts = new Map<string, number>();

  for (const url of urls) {
    const path = new URL(url, "http://core.test/").pathname.replace(/^.*\/api\/v1\//u, "");

    counts.set(path, (counts.get(path) ?? 0) + 1);
  }

  return Object.fromEntries(counts);
}

/** Resolves once `count` has held still for `ms`: a screen has made every request it will. */
export async function settled(count: () => number, ms = 600): Promise<void> {
  const last = count();

  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

  if (count() !== last) await settled(count, ms);
}

/** A core that answers every request with `response` and keeps what it was sent. */
export function answering(response: Response): Transport & { readonly sent: Request[] } {
  const sent: Request[] = [];

  return {
    base: BASE,
    sent,
    fetch: (request) => {
      sent.push(request);

      return Promise.resolve(response);
    },
  };
}

/** An OpenAPI document as a core serves it, with one operation. */
export const API_DOCUMENT = {
  openapi: "3.1.0",
  info: { title: "SunReye", version: "1" },
  tags: [{ name: "views" }],
  paths: {
    "/api/v1/views": {
      get: {
        tags: ["views"],
        summary: "Every saved view",
        operationId: "list_views",
        responses: { 200: { description: "The views" } },
      },
    },
  },
};

/** A fake core's range read (ADR 9): `one` answers each series asked, which is then named. */
export function perSeries<R extends readonly unknown[], T extends object>(
  one: (device: number, series: string, ...rest: R) => T | Problem | Promise<T | Problem>,
) {
  return (device: number, series: readonly string[], ...rest: R) =>
    Promise.all(
      series.map(async (name) => {
        const answer = await one(device, name, ...rest);

        return "problem" in answer ? answer : { ...answer, series: name };
      }),
    );
}

/** A fake core's answer to a range request (ADR 9): `one` answers each series it asks, named. */
export function eachSeries(href: string, one: (series: string) => object) {
  const names = new URL(href, "http://core.test/").searchParams.getAll("series");

  return Response.json({
    series: names.map((name) => Object.assign({}, one(name), { series: name })),
  });
}

/** A range request answered a series at a time from `one`'s answers (ADR 9): one refusal refuses
 * the request, naming its series. Each answer is a JSON object with members. */
export async function eachAnswer(
  series: readonly string[],
  one: (series: string) => Response | Promise<Response>,
): Promise<Response> {
  const answers = await Promise.all(series.map((name) => Promise.resolve(one(name))));
  const bodies = await Promise.all(answers.map((answer) => answer.text()));
  // The series' name as the first member of its answer's object.
  const named = (i: number) => `{"series":${JSON.stringify(series[i])},${bodies[i]?.slice(1)}`;
  const refused = answers.findIndex((answer) => !answer.ok);
  const headers = { "content-type": "application/json" };

  if (refused >= 0)
    return new Response(named(refused), { status: answers[refused]?.status ?? 500, headers });

  return new Response(`{"series":[${series.map((_, i) => named(i)).join(",")}]}`, { headers });
}
