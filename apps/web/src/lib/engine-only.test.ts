import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

// mock-hygiene-ignore-next-line -- SvelteKit virtual modules: no real module exists under bun test. The server-side values keep `$lib/core-api` loadable.
mock.module("$app/environment", () => ({ browser: false }));
// mock-hygiene-ignore-next-line -- SvelteKit virtual module, see above.
mock.module("$app/navigation", () => ({ goto: async () => {} }));
// mock-hygiene-ignore-next-line -- SvelteKit virtual module, see above.
mock.module("$env/dynamic/public", () => ({ env: {} }));

const realCoreApi = await import("$lib/core-api");
const realCoreApiExports = { ...realCoreApi };

type Answer = {
  data?: unknown;
  error?: unknown;
  response?: { ok?: boolean; status?: number };
};
let answer: Answer = {};
const calls: Array<{ route: string; init: unknown }> = [];
const reply = (method: string) => async (path: string, init?: unknown) => {
  calls.push({ route: `${method} ${path}`, init });
  return answer;
};

mock.module("$lib/core-api", () => ({
  ...realCoreApi,
  core: { GET: reply("GET"), POST: reply("POST"), PUT: reply("PUT"), DELETE: reply("DELETE") },
}));

afterAll(() => {
  mock.module("$lib/core-api", () => ({ ...realCoreApiExports }));
});

const {
  postSetting,
  postEvccCommand,
  fetchCostToday,
  listCustomCharts,
  createCustomChart,
  updateCustomChart,
  deleteCustomChart,
} = await import("./engine-only");

beforeEach(() => {
  answer = {};
  calls.length = 0;
});

const input = { name: "Mine", metrics: ["pv.power"] };
const chart = {
  id: "c1",
  name: "Mine",
  metrics: ["pv.power"],
  createdAt: "2026-11-01T00:00:00Z",
  updatedAt: "2026-11-01T00:00:00Z",
};

describe("postSetting", () => {
  test("true when the engine accepted it, sending key and value", async () => {
    expect(await postSetting("k", 0)).toBe(true);
    expect(calls).toEqual([
      { route: "POST /api/commands/setting", init: { body: { key: "k", value: 0 } } },
    ]);
  });

  test("false on an error", async () => {
    answer = { error: { error: "out of range" }, response: { ok: false, status: 400 } };
    expect(await postSetting("k", -1)).toBe(false);
  });

  test("false on a refusal with an empty body", async () => {
    answer = { error: "", response: { ok: false, status: 404 } };
    expect(await postSetting("k", 1)).toBe(false);
  });
});

describe("postEvccCommand", () => {
  const body = { loadpoint: 1, action: "mode", value: "pv" } as const;

  test("null on success", async () => {
    expect(await postEvccCommand(body)).toBeNull();
    expect(calls[0]).toEqual({ route: "POST /api/commands/evcc", init: { body } });
  });

  test("the engine's own message on failure", async () => {
    answer = { error: { error: "loadpoint busy" }, response: { status: 409 } };
    expect(await postEvccCommand(body)).toBe("loadpoint busy");
  });

  test("falls back to the status when the error has no message", async () => {
    answer = { error: "", response: { status: 502 } };
    expect(await postEvccCommand(body)).toBe("Command failed (502)");
    answer = { error: {}, response: { status: 500 } };
    expect(await postEvccCommand(body)).toBe("Command failed (500)");
  });
});

describe("fetchCostToday", () => {
  test("asks for today, carrying the source", async () => {
    const cost = {
      currency: "EUR",
      importCost: 0,
      exportEarnings: 0,
      solarSavings: 0,
      selfSufficiency: null,
      selfConsumption: null,
    };
    answer = { data: cost };
    expect(await fetchCostToday({ source: "plant" })).toEqual(cost);
    expect(calls[0]).toEqual({
      route: "GET /api/cost",
      init: { params: { query: { range: "today", source: "plant" } } },
    });
  });

  test("an empty-string body (Elysia null) and a missing body are null", async () => {
    answer = { data: "" };
    expect(await fetchCostToday({ source: "plant" })).toBeNull();
    answer = {};
    expect(await fetchCostToday({ source: "plant" })).toBeNull();
  });
});

describe("listCustomCharts", () => {
  test("the list when there is one, empty list included", async () => {
    answer = { data: [chart] };
    expect(await listCustomCharts()).toEqual([chart]);
    expect(calls[0]?.route).toBe("GET /api/custom-charts");
    answer = { data: [] };
    expect(await listCustomCharts()).toEqual([]);
  });

  test("null when the engine did not answer with data", async () => {
    answer = { data: null };
    expect(await listCustomCharts()).toBeNull();
  });
});

describe("createCustomChart", () => {
  test("the saved chart", async () => {
    answer = { data: chart };
    expect(await createCustomChart(input)).toEqual({ chart, error: null });
    expect(calls[0]).toEqual({ route: "POST /api/custom-charts", init: { body: input } });
  });

  test("a success with no body is a null chart, not an error", async () => {
    answer = { data: null };
    expect(await createCustomChart(input)).toEqual({
      chart: null,
      error: null,
    });
  });

  test("the engine's message on failure", async () => {
    answer = { error: { error: "name taken" } };
    expect(await createCustomChart(input)).toEqual({
      chart: null,
      error: "name taken",
    });
  });

  test("a generic message when the error carries none", async () => {
    for (const error of [null, "", "boom", {}]) {
      answer = { error };
      expect(await createCustomChart(input)).toEqual({
        chart: null,
        error: "Something went wrong",
      });
    }
  });
});

describe("updateCustomChart", () => {
  test("puts to the chart's id and returns the saved chart", async () => {
    answer = { data: chart };
    expect(await updateCustomChart("c1", input)).toEqual({
      chart,
      error: null,
    });
    expect(calls[0]).toEqual({
      route: "PUT /api/custom-charts/{id}",
      init: { params: { path: { id: "c1" } }, body: input },
    });
  });

  test("null chart on an empty success; message on failure", async () => {
    answer = { data: undefined };
    expect(await updateCustomChart("c1", input)).toEqual({
      chart: null,
      error: null,
    });
    answer = { error: { error: 404 } };
    expect(await updateCustomChart("c1", input)).toEqual({
      chart: null,
      error: "404",
    });
  });
});

describe("deleteCustomChart", () => {
  test("null on success, deleting by id", async () => {
    expect(await deleteCustomChart("c1")).toBeNull();
    expect(calls[0]).toEqual({
      route: "DELETE /api/custom-charts/{id}",
      init: { params: { path: { id: "c1" } } },
    });
  });

  test("the engine's message on failure", async () => {
    answer = { error: { error: "in use" } };
    expect(await deleteCustomChart("c1")).toBe("in use");
  });
});
