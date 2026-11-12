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

/** A test core: answers each request in turn and records its URL. */
export function scripted(
  ...responses: readonly Response[]
): Transport & { readonly urls: string[] } {
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
