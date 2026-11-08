import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

// mock-hygiene-ignore-next-line -- SvelteKit virtual modules: no real module exists under bun test. The server-side values keep `$lib/core-api` loadable.
mock.module("$app/environment", () => ({ browser: false }));
// mock-hygiene-ignore-next-line -- SvelteKit virtual module, see above.
mock.module("$app/navigation", () => ({ goto: async () => {} }));
// mock-hygiene-ignore-next-line -- SvelteKit virtual module, see above.
mock.module("$env/dynamic/public", () => ({ env: {} }));

const realCoreApi = await import("$lib/core-api");
const realCoreApiExports = { ...realCoreApi };

let restartAnswer: { error?: unknown; response?: { ok: boolean } } = {};
/** One entry per `setup-status` poll: a payload, null (server down) or a throw. */
let polls: Array<{ data: object | null } | "throw"> = [];
const calls: string[] = [];
mock.module("$lib/core-api", () => ({
  ...realCoreApi,
  core: {
    GET: async (path: string) => {
      calls.push(`poll ${path}`);
      const next = polls.shift() ?? { data: null };
      if (next === "throw") throw new Error("ECONNREFUSED");
      return next;
    },
    POST: async (path: string) => {
      calls.push(`restart ${path}`);
      return restartAnswer;
    },
  },
}));

afterAll(() => {
  mock.module("$lib/core-api", () => ({ ...realCoreApiExports }));
});

const { restartServer } = await import("./engine-admin");

/** A clock the sleeps advance, so the poll loop runs in no real time. */
const realSetTimeout = globalThis.setTimeout;
const realNow = Date.now;
const realLocation = globalThis.location;
let clock = 0;
let reloads = 0;
let sleeps: number[] = [];

beforeEach(() => {
  clock = 1_000_000;
  reloads = 0;
  sleeps = [];
  calls.length = 0;
  polls = [];
  restartAnswer = {};
  Date.now = () => clock;
  globalThis.setTimeout = ((fn: () => void, ms = 0) => {
    sleeps.push(ms);
    clock += ms;
    fn();
    return 0;
  }) as unknown as typeof setTimeout;
  globalThis.location = { reload: () => void reloads++ } as unknown as Location;
});

afterEach(() => {
  globalThis.setTimeout = realSetTimeout;
  Date.now = realNow;
  globalThis.location = realLocation;
});

describe("restartServer", () => {
  test("a refused restart is false at once: no wait, no poll", async () => {
    restartAnswer = { error: { error: "forbidden" }, response: { ok: false } };
    expect(await restartServer()).toBe(false);
    expect(calls).toEqual(["restart /api/admin/restart"]);
    expect(sleeps).toEqual([]);
  });

  test("a refusal with an empty body is false too", async () => {
    restartAnswer = { error: "", response: { ok: false } };
    expect(await restartServer()).toBe(false);
    expect(sleeps).toEqual([]);
  });

  test("waits for the old process to go down before the first poll", async () => {
    polls = [{ data: {} }];
    await restartServer();
    expect(calls).toEqual(["restart /api/admin/restart", "poll /api/setup-status"]);
    expect(sleeps).toEqual([1200]);
  });

  test("polls until the server answers, then reloads once and is true", async () => {
    polls = [{ data: null }, "throw", { data: { needsSetup: false } }];
    expect(await restartServer()).toBe(true);
    expect(calls.map((c) => c.split(" ")[0])).toEqual(["restart", "poll", "poll", "poll"]);
    expect(reloads).toBe(1);
    expect(sleeps).toEqual([1200, 1000, 1000]);
  });

  test("a server that never returns is false at the deadline, without a reload", async () => {
    expect(await restartServer(3_000)).toBe(false);
    expect(reloads).toBe(0);
    // The budget starts after the 1.2 s down-wait: polls at 0, 1 and 2 s; at 3 s the deadline is met.
    expect(calls.filter((c) => c.startsWith("poll"))).toHaveLength(3);
  });

  test("a zero budget never polls", async () => {
    expect(await restartServer(0)).toBe(false);
    expect(calls).toEqual(["restart /api/admin/restart"]);
  });
});
