/**
 * The generated `/api/v1` surface: who the API-key guard lets in, what each read answers, and
 * how a write that fails is told to a third party. Driven through `app.handle`, so the guard,
 * the validation and the error hook run as one request does.
 */

import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { defineProfile, hydrateProfile, metric } from "@SunReye/inverter-core";
import type { PlantMember } from "../shared/plant-source";
import { liveState } from "../shared/state";
import { WriteRejectedError } from "./write-rejected";

// mock-hygiene-ignore-next-line -- importing the real module boots Better Auth, which reads env and a database; avoiding that is the whole point of mocking it here. `auth` is its only export the server imports.
mock.module("@SunReye/auth", () => ({
  auth: {
    api: {
      verifyApiKey: ({ body }: { body: { key: string } }) => verifyApiKey(body.key),
    },
  },
}));

// The env stub passes every other key through, so the permanent mock stays harmless downstream.
const realEnvModule = await import("@SunReye/env/server");
const realEnvExports = { ...realEnvModule };
const envOverrides: Record<string, unknown> = {};
const envStub = new Proxy(realEnvModule.env, {
  get: (target, prop) =>
    typeof prop === "string" && prop in envOverrides
      ? envOverrides[prop]
      : Reflect.get(target, prop),
});
mock.module("@SunReye/env/server", () => ({ ...realEnvModule, env: envStub }));

const realHistory = await import("../shared/history");
const realHistoryExports = { ...realHistory };
const reads: Array<{ kind: "raw" | "rollup"; q: Record<string, unknown> }> = [];
mock.module("../shared/history", () => ({
  ...realHistory,
  queryRawHistory: async (q: Record<string, unknown>) => {
    reads.push({ kind: "raw", q });
    return [{ time: "2026-09-01T00:00:00Z", value: 1 }];
  },
  queryRollup: async (q: Record<string, unknown>) => {
    reads.push({ kind: "rollup", q });
    return [];
  },
}));

afterAll(() => {
  mock.module("@SunReye/env/server", () => ({ ...realEnvExports }));
  mock.module("../shared/history", () => ({ ...realHistoryExports }));
});

let verifyApiKey: (key: string) => Promise<{ valid: boolean }> = async () => ({ valid: false });

const { entitiesApi } = await import("./entities");
const { buildProfileContext } = await import("./inverter");

const ctx = buildProfileContext(
  hydrateProfile(
    defineProfile({
      id: "api-test",
      name: "API Test",
      manufacturer: "Test",
      version: "1.0.0",
      metrics: [
        metric("battery/soc", {
          label: "SOC",
          unit: "%",
          group: "battery",
          addr: 1,
          role: "battery.soc",
        }),
        metric("setting/max_charge_current", {
          label: "Max charge current",
          unit: "A",
          group: "setting",
          addr: 2,
          access: "rw",
          range: { min: 0, max: 100 },
        }),
      ],
    }),
  ),
);

let writes: Array<[string, number]> = [];
let writeFails: Error | null = null;

function app(over: { members?: () => Promise<PlantMember[]>; ctx?: typeof ctx | null } = {}) {
  return entitiesApi({
    ctx: over.ctx === undefined ? ctx : over.ctx,
    members: over.members,
    write: async (key, value) => {
      if (writeFails) throw writeFails;
      writes.push([key, value]);
    },
  });
}

const call = (
  target: ReturnType<typeof app>,
  path: string,
  init: RequestInit = {},
): Promise<Response> => target.handle(new Request(`http://localhost/api/v1${path}`, init));

const bearer = (key: string) => ({ headers: { authorization: `Bearer ${key}` } });

beforeEach(() => {
  for (const key of Object.keys(envOverrides)) delete envOverrides[key];
  envOverrides.NODE_ENV = "production";
  envOverrides.API_KEYS = ["static-key"];
  verifyApiKey = async () => ({ valid: false });
  reads.length = 0;
  writes = [];
  writeFails = null;
});

describe("the API-key guard", () => {
  test("a static key in the Authorization header is let in", async () => {
    expect((await call(app(), "/entities", bearer("static-key"))).status).toBe(200);
  });

  test("the scheme is case-insensitive and the key is trimmed", async () => {
    const res = await call(app(), "/entities", {
      headers: { authorization: "bEaReR   static-key  " },
    });
    expect(res.status).toBe(200);
  });

  test("a static key in x-api-key is let in", async () => {
    const res = await call(app(), "/entities", { headers: { "x-api-key": "static-key" } });
    expect(res.status).toBe(200);
  });

  test("a wrong key is refused as invalid", async () => {
    const res = await call(app(), "/entities", bearer("nope"));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Invalid or missing API key" });
  });

  test("no credential with keys configured is refused as invalid or missing", async () => {
    const res = await call(app(), "/entities");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Invalid or missing API key" });
  });

  test("a non-bearer Authorization header is not a key", async () => {
    const res = await call(app(), "/entities", { headers: { authorization: "Basic static-key" } });
    expect(res.status).toBe(401);
  });

  test("a managed key the plugin verifies is let in", async () => {
    verifyApiKey = async (key) => ({ valid: key === "managed-key" });
    expect((await call(app(), "/entities", bearer("managed-key"))).status).toBe(200);
    expect((await call(app(), "/entities", bearer("other"))).status).toBe(401);
  });

  test("a verifier that throws never authorizes", async () => {
    verifyApiKey = async () => {
      throw new Error("db down");
    };
    expect((await call(app(), "/entities", bearer("managed-key"))).status).toBe(401);
  });

  test("production with no static keys and no credential says access is not configured", async () => {
    envOverrides.API_KEYS = [];
    const res = await call(app(), "/entities");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "API access is not configured" });
  });

  test("production with no static keys still accepts a managed key", async () => {
    envOverrides.API_KEYS = [];
    verifyApiKey = async () => ({ valid: true });
    expect((await call(app(), "/entities", bearer("managed-key"))).status).toBe(200);
  });

  test("development with no static keys is open", async () => {
    envOverrides.NODE_ENV = "development";
    envOverrides.API_KEYS = [];
    expect((await call(app(), "/entities")).status).toBe(200);
  });

  test("development with static keys still requires one", async () => {
    envOverrides.NODE_ENV = "development";
    expect((await call(app(), "/entities")).status).toBe(401);
  });
});

describe("the catalog and live reads", () => {
  test("an onboarding-only boot mounts no entity routes", async () => {
    expect((await call(app({ ctx: null }), "/entities", bearer("static-key"))).status).toBe(404);
  });

  test("/entities lists the profile's identity and every entity", async () => {
    const body = (await (await call(app(), "/entities", bearer("static-key"))).json()) as {
      id: string;
      entities: Array<{ key: string }>;
    };
    expect(body.id).toBe("api-test");
    expect(body.entities.map((e) => e.key)).toEqual(["battery.soc", "setting.max_charge_current"]);
  });

  test("/state is 503 before the first poll and the sample after it", async () => {
    // `liveState` has no reset; the 503 arm is only reachable while no sample was ever set.
    const before = liveState.latest;
    if (before === null) {
      const res = await call(app(), "/state", bearer("static-key"));
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: "No sample available yet" });
    }
    liveState.set({
      time: "2026-09-01T00:00:00Z",
      inverterId: "api-test",
      metrics: { "battery.soc": 55 },
    });
    const res = await call(app(), "/state", bearer("static-key"));
    expect(await res.json()).toEqual({
      time: "2026-09-01T00:00:00Z",
      inverterId: "api-test",
      values: { "battery.soc": 55 },
    });
  });

  test("/entities/:key is 404 for an unknown key and carries the live value for a known one", async () => {
    liveState.set({ time: "t", inverterId: "api-test", metrics: { "battery.soc": 42 } });
    const unknown = await call(app(), "/entities/nope", bearer("static-key"));
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ error: "Unknown entity: nope" });
    const known = (await (
      await call(app(), "/entities/battery.soc", bearer("static-key"))
    ).json()) as {
      key: string;
      value: number | null;
    };
    expect(known.key).toBe("battery.soc");
    expect(known.value).toBe(42);
  });

  test("a known entity the sample lacks reads null, not undefined", async () => {
    liveState.set({ time: "t", inverterId: "api-test", metrics: {} });
    const body = (await (
      await call(app(), "/entities/battery.soc", bearer("static-key"))
    ).json()) as {
      value: number | null;
    };
    expect(body.value).toBeNull();
  });
});

describe("/entities/:key/history", () => {
  const history = (query = "") =>
    call(app(), `/entities/battery.soc/history${query}`, bearer("static-key"));

  test("an unknown entity is 404 and reads nothing", async () => {
    const res = await call(app(), "/entities/nope/history", bearer("static-key"));
    expect(res.status).toBe(404);
    expect(reads).toEqual([]);
  });

  test("raw samples by default, from the profile's own device and the default window", async () => {
    const before = Date.now();
    expect((await history()).status).toBe(200);
    expect(reads).toHaveLength(1);
    const read = reads[0]!;
    expect(read.kind).toBe("raw");
    expect(read.q).toMatchObject({ metric: "battery.soc", inverterId: "api-test", limit: 5000 });
    const since = (read.q.since as Date).getTime();
    expect(Math.abs(before - 24 * 3_600_000 - since)).toBeLessThan(5_000);
  });

  test("a bucket reads the rollup, with hours and limit applied", async () => {
    await history("?bucket=hour&hours=2&limit=10");
    const read = reads[0]!;
    expect(read.kind).toBe("rollup");
    expect(read.q).toMatchObject({ bucket: "hour", limit: 10 });
    expect(Date.now() - 2 * 3_600_000 - (read.q.since as Date).getTime()).toBeLessThan(5_000);
  });

  test("source names a device slug", async () => {
    await history("?source=meter-2");
    expect(reads[0]!.q).toMatchObject({ inverterId: "meter-2" });
  });

  test("source=plant with no members folds the empty set, never throws", async () => {
    const res = await history("?source=plant");
    expect(res.status).toBe(200);
    expect(reads[0]!.q).toMatchObject({ inverterId: "plant", plant: { members: [] } });
  });

  test("source=plant asks the injected members once", async () => {
    let asked = 0;
    const members = async () => {
      asked++;
      return [] as PlantMember[];
    };
    await call(
      app({ members }),
      "/entities/battery.soc/history?source=plant",
      bearer("static-key"),
    );
    expect(asked).toBe(1);
  });

  const two = async () =>
    [
      { id: 1, slug: "a", profileId: "api-test", weight: 1 },
      { id: 2, slug: "b", profileId: "api-test", weight: 1 },
    ] as PlantMember[];

  test("source=plant folds a role's metric across the members", async () => {
    await call(
      app({ members: two }),
      "/entities/battery.soc/history?source=plant",
      bearer("static-key"),
    );
    expect(reads[0]!.q).toMatchObject({
      inverterId: "plant",
      plant: { members: [{ slug: "a" }, { slug: "b" }] },
    });
  });

  test("source=plant on a metric with no role is refused 422 and reads nothing", async () => {
    const res = await call(
      app({ members: two }),
      "/entities/setting.max_charge_current/history?source=plant",
      bearer("static-key"),
    );
    expect(res.status).toBe(422);
    expect(reads).toEqual([]);
  });

  test("a bucket outside minute, hour or day is a 422 from validation", async () => {
    const res = await history("?bucket=week");
    expect(res.status).toBe(422);
    expect(reads).toEqual([]);
  });

  test("an out-of-range limit is a 422", async () => {
    expect((await history("?limit=50001")).status).toBe(422);
    expect((await history("?hours=0")).status).toBe(422);
  });
});

describe("the generated write route", () => {
  const put = (key: string, body: unknown) =>
    call(app(), `/entities/${key}`, {
      method: "PUT",
      headers: { authorization: "Bearer static-key", "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  test("a writable entity accepts a value and echoes it", async () => {
    const res = await put("setting.max_charge_current", { value: 40 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, key: "setting.max_charge_current", value: 40 });
    expect(writes).toEqual([["setting.max_charge_current", 40]]);
  });

  test("zero is a value", async () => {
    expect((await put("setting.max_charge_current", { value: 0 })).status).toBe(200);
    expect(writes).toEqual([["setting.max_charge_current", 0]]);
  });

  // The error hook maps Elysia's NotFoundError to 500 (only validation and parse errors keep a
  // status); the guarantee here is that nothing is written.
  test("a read-only entity has no write route", async () => {
    expect((await put("battery.soc", { value: 1 })).status).not.toBe(200);
    expect(writes).toEqual([]);
  });

  test("a value outside the profile's range never reaches the writer", async () => {
    const res = await put("setting.max_charge_current", { value: 101 });
    expect(res.status).toBe(422);
    expect(writes).toEqual([]);
  });

  test("a rejected write is the caller's mistake: 400 with the reason", async () => {
    writeFails = new WriteRejectedError("Value must be one of: 0, 1");
    const res = await put("setting.max_charge_current", { value: 40 });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Value must be one of: 0, 1" });
  });

  test("any other failure is a bare 500: no message, no stack", async () => {
    writeFails = new Error("modbus timeout at 10.0.0.5");
    const res = await put("setting.max_charge_current", { value: 40 });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Internal server error" });
  });

  test("the write route is behind the guard too", async () => {
    const res = await call(app(), "/entities/setting.max_charge_current", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: 40 }),
    });
    expect(res.status).toBe(401);
    expect(writes).toEqual([]);
  });
});
