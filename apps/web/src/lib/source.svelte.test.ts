import { afterEach, expect, test, vi } from "vitest";

vi.mock("$env/dynamic/public", () => ({ env: {} }));

const { source } = await import("./source.svelte");
const { PLANT, STORAGE_KEY } = await import("./source");

afterEach(() => {
  source.select(PLANT);
  localStorage.removeItem(STORAGE_KEY);
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
