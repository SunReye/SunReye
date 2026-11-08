import { afterEach, expect, test, vi } from "vitest";

vi.mock("$env/dynamic/public", () => ({ env: {} }));
const get = vi.hoisted(() => vi.fn());
vi.mock("$lib/core-api", () => ({ core: { GET: get } }));
const postSetting = vi.hoisted(() => vi.fn());
vi.mock("$lib/engine-only", () => ({ postSetting }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("svelte-sonner", () => ({ toast }));

const { coreCapabilities } = await import("$lib/capabilities.svelte");
const { TouController } = await import("./tou.svelte");

afterEach(() => {
  get.mockReset();
  postSetting.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
});

test("writes a schedule field while the core serves controls", async () => {
  get.mockResolvedValue({ data: { controls: true } });
  postSetting.mockResolvedValue(true);
  await coreCapabilities.load();
  const controller = new TouController();
  await controller.write("timeofuse.time.1", 530, "Start");
  expect(postSetting).toHaveBeenCalledWith("timeofuse.time.1", 530);
  expect(controller.value("timeofuse.time.1")).toBe(530);
});

test("sends nothing and keeps no pending value when the core reports controls absent", async () => {
  get.mockResolvedValue({ data: { controls: false } });
  await coreCapabilities.load();
  const controller = new TouController();
  await controller.write("timeofuse.time.1", 530, "Start");
  expect(postSetting).not.toHaveBeenCalled();
  expect(controller.value("timeofuse.time.1")).toBeUndefined();
  expect(controller.busy("timeofuse.time.1")).toBe(false);
});

test("a refused write drops the pending value and frees the field", async () => {
  get.mockResolvedValue({ data: { controls: true } });
  postSetting.mockResolvedValue(false);
  await coreCapabilities.load();
  const controller = new TouController();
  await controller.write("timeofuse.time.1", 530, "Start");
  expect(postSetting).toHaveBeenCalledWith("timeofuse.time.1", 530);
  expect(controller.value("timeofuse.time.1")).toBeUndefined();
  expect(controller.busy("timeofuse.time.1")).toBe(false);
});

test("a write that rejects toasts the failure, drops the pending value and frees the field", async () => {
  get.mockResolvedValue({ data: { controls: true } });
  postSetting.mockRejectedValue(new Error("boom"));
  await coreCapabilities.load();
  const controller = new TouController();
  await controller.write("timeofuse.time.1", 530, "Start");
  expect(toast.error).toHaveBeenCalledTimes(1);
  expect(toast.success).not.toHaveBeenCalled();
  expect(controller.value("timeofuse.time.1")).toBeUndefined();
  expect(controller.busy("timeofuse.time.1")).toBe(false);
});
