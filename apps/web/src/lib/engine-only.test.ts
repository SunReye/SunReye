import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

// mock-hygiene-ignore-next-line -- SvelteKit virtual modules: no real module exists under bun test. The server-side values keep `$lib/api` loadable.
mock.module("$app/environment", () => ({ browser: false }));
// mock-hygiene-ignore-next-line -- SvelteKit virtual module, see above.
mock.module("$app/navigation", () => ({ goto: async () => {} }));
// mock-hygiene-ignore-next-line -- SvelteKit virtual module, see above.
mock.module("$env/dynamic/public", () => ({ env: {} }));

const realApi = await import("$lib/api");
const realApiExports = { ...realApi };

type Answer = {
  data?: unknown;
  error?: { status?: number; value?: unknown } | null;
};
let answer: Answer = {};
const calls: Array<{ route: string; args: unknown }> = [];
const reply = (route: string) => async (args?: unknown) => {
  calls.push({ route, args });
  return answer;
};
const chartRoute = (id: string) => ({
  put: reply(`put ${id}`),
  delete: reply(`delete ${id}`),
});
const customCharts = Object.assign((arg: { id: string }) => chartRoute(arg.id), {
  get: reply("get charts"),
  post: reply("post chart"),
});

mock.module("$lib/api", () => ({
  ...realApi,
  api: {
    api: {
      commands: {
        setting: { post: reply("setting") },
        evcc: { post: reply("evcc") },
      },
      cost: { get: reply("cost") },
      "custom-charts": customCharts,
    },
  },
}));

afterAll(() => {
  mock.module("$lib/api", () => ({ ...realApiExports }));
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
const chart = { id: "c1", name: "Mine" };

describe("postSetting", () => {
  test("true when the engine accepted it, sending key and value", async () => {
    expect(await postSetting("k", 0)).toBe(true);
    expect(calls).toEqual([{ route: "setting", args: { key: "k", value: 0 } }]);
  });

  test("false on an error", async () => {
    answer = { error: { status: 400 } };
    expect(await postSetting("k", -1)).toBe(false);
  });
});

describe("postEvccCommand", () => {
  const body = { loadpoint: 1, action: "mode", value: "pv" } as const;

  test("null on success", async () => {
    expect(await postEvccCommand(body)).toBeNull();
    expect(calls[0]).toEqual({ route: "evcc", args: body });
  });

  test("the engine's own message on failure", async () => {
    answer = { error: { status: 409, value: { error: "loadpoint busy" } } };
    expect(await postEvccCommand(body)).toBe("loadpoint busy");
  });

  test("falls back to the status when the error has no message", async () => {
    answer = { error: { status: 502, value: null } };
    expect(await postEvccCommand(body)).toBe("Command failed (502)");
    answer = { error: { status: 500, value: {} } };
    expect(await postEvccCommand(body)).toBe("Command failed (500)");
  });
});

describe("fetchCostToday", () => {
  test("asks for today, carrying the source", async () => {
    answer = { data: { currency: "EUR", importCost: 0 } };
    expect(await fetchCostToday({ source: "plant" })).toEqual({
      currency: "EUR",
      importCost: 0,
    });
    expect(calls[0]).toEqual({
      route: "cost",
      args: { query: { range: "today", source: "plant" } },
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
    expect(calls[0]).toEqual({ route: "post chart", args: input });
  });

  test("a success with no body is a null chart, not an error", async () => {
    answer = { data: null };
    expect(await createCustomChart(input)).toEqual({
      chart: null,
      error: null,
    });
  });

  test("the engine's message on failure", async () => {
    answer = { error: { value: { error: "name taken" } } };
    expect(await createCustomChart(input)).toEqual({
      chart: null,
      error: "name taken",
    });
  });

  test("a generic message when the error carries none", async () => {
    for (const value of [undefined, null, "boom", {}]) {
      answer = { error: { value } };
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
    expect(calls[0]).toEqual({ route: "put c1", args: input });
  });

  test("null chart on an empty success; message on failure", async () => {
    answer = { data: undefined };
    expect(await updateCustomChart("c1", input)).toEqual({
      chart: null,
      error: null,
    });
    answer = { error: { value: { error: 404 } } };
    expect(await updateCustomChart("c1", input)).toEqual({
      chart: null,
      error: "404",
    });
  });
});

describe("deleteCustomChart", () => {
  test("null on success, deleting by id", async () => {
    expect(await deleteCustomChart("c1")).toBeNull();
    expect(calls[0]?.route).toBe("delete c1");
  });

  test("the engine's message on failure", async () => {
    answer = { error: { value: { error: "in use" } } };
    expect(await deleteCustomChart("c1")).toBe("in use");
  });
});
