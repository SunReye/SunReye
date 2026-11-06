import { afterEach, expect, test, vi } from "vitest";

vi.mock("$env/dynamic/public", () => ({ env: {} }));
const get = vi.fn();
vi.mock("$lib/core-api", () => ({ core: { GET: get } }));

const { source } = await import("./source.svelte");
const { PLANT, STORAGE_KEY } = await import("./source");

afterEach(() => {
  source.select(PLANT);
  localStorage.removeItem(STORAGE_KEY);
  get.mockReset();
});

const device = (slug: string, retired = false) => ({
  slug,
  name: `Device ${slug}`,
  profileId: "deye",
  role: "inverter",
  retired,
  member: !retired,
});
const roster = (...devices: ReturnType<typeof device>[]) => ({
  plant: { members: devices.filter((d) => d.member).map((d) => d.slug), timeZone: "Europe/Berlin" },
  devices,
});

test("the source list is read from the core, and a saved decimal-id device is honoured", async () => {
  localStorage.setItem(STORAGE_KEY, "12");
  get.mockResolvedValue({ data: roster(device("2"), device("12")) });

  await source.reload();

  expect(get).toHaveBeenCalledWith("/api/sources");
  expect(source.current).toBe("12");
  expect(source.offersChoice).toBe(true);
  expect(source.plantZone).toBe("Europe/Berlin");
});

test("a saved device the core reports retired falls back to the plant", async () => {
  localStorage.setItem(STORAGE_KEY, "2");
  get.mockResolvedValue({ data: roster(device("1"), device("2", true)) });

  await source.reload();

  expect(source.current).toBe(PLANT);
  expect(source.offersChoice).toBe(false);
});

test("a core that refuses or cannot be reached leaves the plant with no switcher", async () => {
  get.mockResolvedValue({ data: undefined, error: { error: "unauthorized" } });
  await source.reload();
  expect(source.current).toBe(PLANT);
  expect(source.offersChoice).toBe(false);

  get.mockRejectedValue(new TypeError("network"));
  await source.reload();
  expect(source.current).toBe(PLANT);
  expect(source.offersChoice).toBe(false);
});

test("picking a device re-scopes every read and survives a reload", () => {
  source.select("inv-2");

  expect(source.current).toBe("inv-2");
  expect(source.isPlant).toBe(false);
  expect(source.query).toEqual({ source: "inv-2" });
  expect(localStorage.getItem(STORAGE_KEY)).toBe("inv-2");
});

test("the live buffers re-seed once per change, never for a repeat pick", () => {
  const reseed = vi.fn();
  const detach = source.onSelect(reseed);

  source.select("inv-2");
  source.select("inv-2");
  expect(reseed).toHaveBeenCalledTimes(1);

  detach();
  source.select(PLANT);
  expect(reseed).toHaveBeenCalledTimes(1);
});

test("a browser that refuses storage still switches for this page", () => {
  const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("quota", "QuotaExceededError");
  });
  const reseed = vi.fn();
  const detach = source.onSelect(reseed);

  source.select("inv-3");

  expect(source.current).toBe("inv-3");
  expect(reseed).toHaveBeenCalledTimes(1);
  detach();
  setItem.mockRestore();
});
