import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { renderCoreApiTypes, TYPES_FILE } from "../../scripts/gen-core-api";

// mock-hygiene-ignore-next-line -- SvelteKit virtual module: no real module exists under bun test. Server-side while the client loads, flipped to the browser per case.
mock.module("$app/environment", () => ({ browser: false }));
const gone: string[] = [];
// mock-hygiene-ignore-next-line -- SvelteKit virtual module, see above.
mock.module("$app/navigation", () => ({ goto: async (to: string) => void gone.push(to) }));
// mock-hygiene-ignore-next-line -- SvelteKit virtual module, see above.
mock.module("$env/dynamic/public", () => ({ env: {} }));
const observed: Array<[number, unknown]> = [];
// mock-hygiene-ignore-next-line -- a rune module: it cannot be compiled, so cannot be imported, under bun test.
mock.module("$lib/history-incomplete.svelte", () => ({
  historyIncomplete: { observe: (status: number, body: unknown) => observed.push([status, body]) },
}));

afterAll(() => {
  // mock-hygiene-ignore-next-line -- same virtual module, handed back as the server-side value.
  mock.module("$app/environment", () => ({ browser: false }));
});

// openapi-fetch binds `fetch` when the client is created, so the stub is installed first and
// each case swaps what it answers with.
let answer: (input: unknown, init?: RequestInit) => Promise<Response> = async () =>
  new Response("{}");
const realFetch = globalThis.fetch;
globalThis.fetch = ((input: unknown, init?: RequestInit) =>
  answer(input, init)) as unknown as typeof fetch;
const { core } = await import("./core-api");

/** One request through the real client, answered with `status` and `body`. */
async function send(status: number, body = "{}", path = "/api/probe") {
  const response = new Response(body, { status });
  answer = async () => response;
  // The path is arbitrary: the hook sees every response whatever route asked.
  await core.GET(path as never);
  return response;
}

const SENTINEL = { error: "sentinel" };

/** Poll until `check` holds; the deadline only bounds a hang. */
async function until(check: () => boolean, ms = 5_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("condition not met in time");
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

/**
 * Wait for the hook's fire-and-forget work. The bounce loads `$app/navigation` lazily, so an
 * import of it queues behind the bounce's own. The banner read has no signal, so a 422 sent
 * after the request under test is awaited until it is observed: its body is read after
 * every earlier one, so whatever an earlier response was going to report is already in `observed`.
 */
async function settleHook() {
  await import("$app/navigation");
  await send(422, JSON.stringify(SENTINEL));
  await until(() => observed.some(([, body]) => isSentinel(body)));
  const mine = observed.filter(([, body]) => !isSentinel(body));
  observed.splice(0, observed.length, ...mine);
}

const isSentinel = (body: unknown) => JSON.stringify(body) === JSON.stringify(SENTINEL);

/** {@link send}, then wait for the hook to finish. */
async function request(status: number, body = "{}", path = "/api/probe") {
  const response = await send(status, body, path);
  await settleHook();
  return response;
}

const realLocation = globalThis.location;
const at = (hash: string) => {
  globalThis.location = {
    href: `http://host/app/${hash}`,
    pathname: "/app/",
    search: "",
  } as Location;
};

beforeEach(() => {
  // mock-hygiene-ignore-next-line -- same virtual module, set to the browser for each case.
  mock.module("$app/environment", () => ({ browser: true }));
  gone.length = 0;
  observed.length = 0;
  at("#/history");
});

afterEach(() => {
  globalThis.location = realLocation;
});

afterAll(() => {
  globalThis.fetch = realFetch;
});

test("core-api.gen.ts is generated from the committed OpenAPI document", async () => {
  const committed = await Bun.file(TYPES_FILE).text();
  // Stale types name the fix: the core's routes moved and the web client did not.
  expect(committed, "run `bun run --cwd apps/web gen:core-api`").toBe(await renderCoreApiTypes());
});

describe("a 401", () => {
  test("bounces to the login route from any other page", async () => {
    await request(401);
    expect(gone).toEqual(["/app/#/login"]);
  });

  test.each(["#/login", "#/onboarding", "#/setup", "#/setup?step=2"])(
    "does not bounce from the pre-auth page %s",
    async (hash) => {
      at(hash);
      await request(401);
      expect(gone).toEqual([]);
    },
  );

  test("other failures do not bounce", async () => {
    await request(403);
    await request(500);
    expect(gone).toEqual([]);
  });

  test("an auth route's 401 is its own answer, not an expiry", async () => {
    await request(401, "{}", "/api/auth/session");
    expect(gone).toEqual([]);
  });

  test("outside the browser nothing bounces", async () => {
    // mock-hygiene-ignore-next-line -- same virtual module, flipped to the server for one case.
    mock.module("$app/environment", () => ({ browser: false }));
    await request(401);
    expect(gone).toEqual([]);
  });
});

describe("a 422", () => {
  test("hands the parsed body to the incomplete-range banner", async () => {
    await request(422, JSON.stringify({ error: "history incomplete" }));
    expect(observed).toEqual([[422, { error: "history incomplete" }]]);
  });

  test("a non-JSON 422 is somebody else's: nothing observed, nothing thrown", async () => {
    await request(422, "not json");
    expect(observed).toEqual([]);
  });

  test("other statuses are never read", async () => {
    await request(200);
    await request(404);
    expect(observed).toEqual([]);
  });
});

test("the client sends the session cookie", async () => {
  let init: RequestInit | undefined;
  answer = async (input, i) => {
    init = i ?? (input as Request);
    return new Response("{}");
  };
  await core.GET("/api/probe" as never);
  expect(init?.credentials).toBe("include");
});
