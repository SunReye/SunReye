// The tariff tests' fake core: answers by method and path, and one live snapshot (ADR 12).
import type { Transport } from "../api/core.ts";

export type Answer = () => Response;

export interface Sent {
  /** The method, path and query. */
  readonly route: string;
  readonly body: unknown;
}

export interface TestCore extends Transport {
  readonly sent: readonly Sent[];
}

const SNAPSHOT = {
  devices: {
    "4294967293": { "price.import": 0.3, "price.export": 0.08, "cost.savings.rate": 0.1 },
    "4294967292": { "price.spot": 0.1234 },
  },
};

const STREAM = `event: snapshot\ndata: ${JSON.stringify(SNAPSHOT)}\n\n`;

/** A test core answering `routes` by method and path; the live stream sends one snapshot. */
export function testCore(routes: Readonly<Record<string, Answer>>): TestCore {
  const sent: Sent[] = [];
  let streamed = false;

  function live(): Promise<Response> {
    if (streamed) return Promise.withResolvers<Response>().promise;

    streamed = true;

    return Promise.resolve(
      new Response(STREAM, { headers: { "content-type": "text/event-stream" } }),
    );
  }

  return {
    base: "http://core.test/",
    sent,
    fetch: async (request) => {
      const { pathname, search } = new URL(request.url);
      const route = `${request.method} ${pathname}`;
      const text = await request.text();

      sent.push({ route: route + search, body: text === "" ? undefined : JSON.parse(text) });

      return pathname === "/api/v1/live" ? live() : (routes[route]?.() ?? forbidden());
    },
  };
}

/** The screen at the current month. */
export const NOW = { params: new URLSearchParams(), go: () => {} };

function forbidden(): Response {
  return Response.json(
    { status: 403, code: "auth.forbidden" },
    { status: 403, headers: { "content-type": "application/problem+json" } },
  );
}
