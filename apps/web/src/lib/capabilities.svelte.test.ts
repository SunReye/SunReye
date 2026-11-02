import { afterEach, expect, test, vi } from "vitest";

vi.mock("$env/dynamic/public", () => ({ env: {} }));
const get = vi.fn();
vi.mock("$lib/core-api", () => ({ core: { GET: get } }));

const { coreCapabilities } = await import("./capabilities.svelte");

const ABSENT = {
  history: false,
  statistics: false,
  controls: false,
  automations: false,
  restart: false,
  profileSources: false,
};

afterEach(() => get.mockReset());

test("an area the core reports absent is reported absent, the others stay", async () => {
  get.mockResolvedValue({ data: { ...ABSENT, history: true } });
  await coreCapabilities.load();

  expect(get).toHaveBeenCalledWith("/api/capabilities");
  expect(coreCapabilities.has("history")).toBe(true);
  expect(coreCapabilities.has("restart")).toBe(false);
});

test("an engine that has no capabilities endpoint keeps every area", async () => {
  get.mockResolvedValue({ data: undefined, error: "Not Found" });
  await coreCapabilities.load();
  expect(coreCapabilities.has("restart")).toBe(true);
});

test("an engine that cannot be reached keeps every area", async () => {
  get.mockResolvedValue({ data: ABSENT });
  await coreCapabilities.load();
  expect(coreCapabilities.has("restart")).toBe(false);

  get.mockRejectedValue(new TypeError("network"));
  await coreCapabilities.load();
  expect(coreCapabilities.has("restart")).toBe(true);
});
