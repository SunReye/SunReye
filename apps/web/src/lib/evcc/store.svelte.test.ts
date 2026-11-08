import { afterEach, expect, test, vi } from "vitest";

vi.mock("$env/dynamic/public", () => ({ env: {} }));
const get = vi.hoisted(() => vi.fn());
vi.mock("$lib/core-api", () => ({ core: { GET: get } }));
const postEvccCommand = vi.hoisted(() => vi.fn());
vi.mock("$lib/engine-only", () => ({ postEvccCommand }));

const { coreCapabilities } = await import("$lib/capabilities.svelte");
const { evcc } = await import("./store.svelte");

afterEach(() => {
  get.mockReset();
  postEvccCommand.mockReset();
});

test("setMode and setLimitSoc post the loadpoint command while the core serves EVCC commands", async () => {
  get.mockResolvedValue({ data: { evccCommands: true } });
  postEvccCommand.mockResolvedValue(null);
  await coreCapabilities.load();
  expect(await evcc.setMode(2, "minpv")).toBeNull();
  expect(postEvccCommand).toHaveBeenLastCalledWith({
    loadpoint: 2,
    action: "mode",
    value: "minpv",
  });
  expect(await evcc.setLimitSoc(2, 80)).toBeNull();
  expect(postEvccCommand).toHaveBeenLastCalledWith({ loadpoint: 2, action: "limitSoc", value: 80 });
});

test("setMode and setLimitSoc send nothing when the core reports EVCC commands absent", async () => {
  get.mockResolvedValue({ data: { evccCommands: false } });
  await coreCapabilities.load();
  await evcc.setMode(2, "now");
  await evcc.setLimitSoc(2, 80);
  expect(postEvccCommand).not.toHaveBeenCalled();
});
