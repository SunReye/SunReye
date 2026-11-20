/// <reference types="bun" />
import type { Transport } from "./core.ts";

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

/** Collects `count` live updates, then stops the stream. */

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
