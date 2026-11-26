// The tariff tests' fake core: answers by method and path (ADR 12).
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

/** A test core answering `routes` by method and path. */
export function testCore(routes: Readonly<Record<string, Answer>>): TestCore {
  const sent: Sent[] = [];

  return {
    base: "http://core.test/",
    sent,
    fetch: async (request) => {
      const { pathname, search } = new URL(request.url);
      const route = `${request.method} ${pathname}`;
      const text = await request.text();

      sent.push({ route: route + search, body: text === "" ? undefined : JSON.parse(text) });

      return routes[route]?.() ?? forbidden();
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
