import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("$env/dynamic/public", () => ({ env: {} }));
const get = vi.hoisted(() => vi.fn());
const put = vi.hoisted(() => vi.fn());
const post = vi.hoisted(() => vi.fn());
vi.mock("$lib/core-api", () => ({ core: { GET: get, PUT: put, POST: post } }));

/** A refusal as openapi-fetch reports one: an error body and a non-2xx response. */
const refusal = (status: number, error: unknown = { error: "no" }) => ({
  error,
  response: { ok: false, status },
});

/** A store module as a fresh instance: each store is a singleton that remembers its first load. */
let instance = 0;
const fresh = <T>(load: (suffix: string) => Promise<T>) => load(`?fresh=${(instance += 1)}`);

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  for (const fn of [get, put, post]) fn.mockReset();
});

describe("display", () => {
  const SAVED = { hourCycle: "24h", timeZone: "Europe/Berlin" };

  test("loads once from the core and shares the request", async () => {
    get.mockResolvedValue({ data: SAVED });
    const { display } = await fresh(
      (q) =>
        import(/* @vite-ignore */ `./display.svelte${q}`) as Promise<
          typeof import("./display.svelte")
        >,
    );
    await Promise.all([display.load(), display.load()]);
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith("/api/settings/display");
    expect(display.config).toEqual(SAVED);
  });

  test("keeps the defaults when the route answers nothing", async () => {
    get.mockResolvedValue(refusal(404, ""));
    const { display } = await fresh(
      (q) =>
        import(/* @vite-ignore */ `./display.svelte${q}`) as Promise<
          typeof import("./display.svelte")
        >,
    );
    await display.load();
    expect(display.config).toEqual({ hourCycle: "auto", timeZone: "auto" });
  });

  test("save writes the draft and adopts the answer", async () => {
    put.mockResolvedValue({ data: SAVED });
    const { display } = await fresh(
      (q) =>
        import(/* @vite-ignore */ `./display.svelte${q}`) as Promise<
          typeof import("./display.svelte")
        >,
    );
    expect(await display.save({ hourCycle: "12h", timeZone: "auto" })).toBe(true);
    expect(put).toHaveBeenCalledWith("/api/settings/display", {
      body: { hourCycle: "12h", timeZone: "auto" },
    });
    expect(display.config).toEqual(SAVED);
  });

  test("a refusal, even with an empty body, leaves the config alone", async () => {
    put.mockResolvedValue(refusal(404, ""));
    const { display } = await fresh(
      (q) =>
        import(/* @vite-ignore */ `./display.svelte${q}`) as Promise<
          typeof import("./display.svelte")
        >,
    );
    expect(await display.save(SAVED as never)).toBe(false);
    expect(display.config.timeZone).toBe("auto");
  });
});

describe("uiPrefs", () => {
  test("loads, reloads past the cache, and saves through /api/settings/ui", async () => {
    get.mockResolvedValue({ data: { hiddenKeys: ["a"], hiddenGroups: [] } });
    put.mockResolvedValue({ data: { hiddenKeys: [], hiddenGroups: ["g"] } });
    const { uiPrefs } = await fresh(
      (q) =>
        import(/* @vite-ignore */ `./ui-prefs.svelte${q}`) as Promise<
          typeof import("./ui-prefs.svelte")
        >,
    );
    await uiPrefs.load();
    expect(uiPrefs.isHidden("a", "x")).toBe(true);
    get.mockResolvedValue({ data: { hiddenKeys: ["b"], hiddenGroups: [] } });
    await uiPrefs.load();
    expect(uiPrefs.isHidden("b", "x")).toBe(false);
    await uiPrefs.reload();
    expect(uiPrefs.isHidden("b", "x")).toBe(true);
    expect(await uiPrefs.save({ hiddenKeys: [], hiddenGroups: ["g"] })).toBe(true);
    expect(put).toHaveBeenCalledWith("/api/settings/ui", {
      body: { hiddenKeys: [], hiddenGroups: ["g"] },
    });
    expect(uiPrefs.isHidden("a", "g")).toBe(true);
  });

  test("a refused save is false", async () => {
    put.mockResolvedValue(refusal(403));
    const { uiPrefs } = await fresh(
      (q) =>
        import(/* @vite-ignore */ `./ui-prefs.svelte${q}`) as Promise<
          typeof import("./ui-prefs.svelte")
        >,
    );
    expect(await uiPrefs.save({ hiddenKeys: ["a"], hiddenGroups: [] })).toBe(false);
    expect(uiPrefs.isHidden("a", "x")).toBe(false);
  });
});

describe("statisticsPrefs", () => {
  test("loads and saves through /api/settings/statistics", async () => {
    const { defaultStatisticsPrefs, statisticsPrefs } = await fresh(
      (q) =>
        import(/* @vite-ignore */ `./statistics-prefs.svelte${q}`) as Promise<
          typeof import("./statistics-prefs.svelte")
        >,
    );
    const hidden = { ...defaultStatisticsPrefs, hiddenSections: ["cost"] };
    get.mockResolvedValue({ data: hidden });
    await statisticsPrefs.load();
    expect(get).toHaveBeenCalledWith("/api/settings/statistics");
    expect(statisticsPrefs.isSectionHidden("cost")).toBe(true);
    put.mockResolvedValue({ data: defaultStatisticsPrefs });
    expect(await statisticsPrefs.save(defaultStatisticsPrefs)).toBe(true);
    expect(put).toHaveBeenCalledWith("/api/settings/statistics", { body: defaultStatisticsPrefs });
    expect(statisticsPrefs.isSectionHidden("cost")).toBe(false);
  });

  test("a refused save is false", async () => {
    put.mockResolvedValue(refusal(500));
    const { defaultStatisticsPrefs, statisticsPrefs } = await fresh(
      (q) =>
        import(/* @vite-ignore */ `./statistics-prefs.svelte${q}`) as Promise<
          typeof import("./statistics-prefs.svelte")
        >,
    );
    expect(await statisticsPrefs.save(defaultStatisticsPrefs)).toBe(false);
  });
});

describe("chartPalette", () => {
  test("loads the instance preset and remembers it for the next paint", async () => {
    get.mockResolvedValue({ data: { preset: "colorblind" } });
    const { chartPalette } = await fresh(
      (q) =>
        import(/* @vite-ignore */ `./chart-palette.svelte${q}`) as Promise<
          typeof import("./chart-palette.svelte")
        >,
    );
    await chartPalette.load();
    expect(get).toHaveBeenCalledWith("/api/settings/chart-palette");
    expect(chartPalette.instance).toBe("colorblind");
    expect(localStorage.getItem("sunreye.palette.instance")).toBe("colorblind");
  });

  test("ignores a preset it does not know", async () => {
    get.mockResolvedValue({ data: { preset: "neon" } });
    const { chartPalette } = await fresh(
      (q) =>
        import(/* @vite-ignore */ `./chart-palette.svelte${q}`) as Promise<
          typeof import("./chart-palette.svelte")
        >,
    );
    await chartPalette.load();
    expect(chartPalette.instance).toBe("categorical");
  });

  test("saves the preset, and a refusal changes nothing", async () => {
    const { chartPalette } = await fresh(
      (q) =>
        import(/* @vite-ignore */ `./chart-palette.svelte${q}`) as Promise<
          typeof import("./chart-palette.svelte")
        >,
    );
    put.mockResolvedValue({ data: { preset: "colorblind" } });
    expect(await chartPalette.save("colorblind")).toBe(true);
    expect(put).toHaveBeenCalledWith("/api/settings/chart-palette", {
      body: { preset: "colorblind" },
    });
    put.mockResolvedValue(refusal(403));
    expect(await chartPalette.save("categorical")).toBe(false);
    expect(chartPalette.instance).toBe("colorblind");
  });
});

describe("plant", () => {
  test("loads and saves through /api/settings/plant", async () => {
    get.mockResolvedValue({ data: { timeZone: "Europe/Berlin", name: "Home" } });
    const { plant } = await fresh(
      (q) =>
        import(/* @vite-ignore */ `./plant.svelte${q}`) as Promise<typeof import("./plant.svelte")>,
    );
    await plant.load();
    expect(get).toHaveBeenCalledWith("/api/settings/plant");
    expect(plant.config.timeZone).toBe("Europe/Berlin");
    put.mockResolvedValue({ data: "" });
    expect(await plant.save({ timeZone: "UTC" })).toBe(true);
    // An empty body is not a payload: the draft stands.
    expect(plant.config).toEqual({ timeZone: "UTC" });
  });

  test("a refused save is false", async () => {
    put.mockResolvedValue(refusal(404, ""));
    const { plant } = await fresh(
      (q) =>
        import(/* @vite-ignore */ `./plant.svelte${q}`) as Promise<typeof import("./plant.svelte")>,
    );
    expect(await plant.save({ timeZone: "UTC" })).toBe(false);
    expect(plant.config.timeZone).toBe("auto");
  });
});

describe("migration", () => {
  const STATUS = { onboardingRequired: true, backfillOutstanding: false, banner: null };
  const NAMES = {
    plantName: "Home",
    deviceName: "Roof",
    migrateHistory: "later",
  } as const;

  test("load reads the status once", async () => {
    get.mockResolvedValue({ data: STATUS });
    const { migration } = await fresh(
      (q) =>
        import(/* @vite-ignore */ `./migration.svelte${q}`) as Promise<
          typeof import("./migration.svelte")
        >,
    );
    await Promise.all([migration.load(), migration.load()]);
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith("/api/migration/status");
    expect(migration.status?.onboardingRequired).toBe(true);
  });

  test("confirm posts the names, then re-reads the status", async () => {
    get.mockResolvedValue({ data: { ...STATUS, onboardingRequired: false } });
    post.mockResolvedValue({ data: {} });
    const { migration } = await fresh(
      (q) =>
        import(/* @vite-ignore */ `./migration.svelte${q}`) as Promise<
          typeof import("./migration.svelte")
        >,
    );
    expect(await migration.confirm(NAMES)).toEqual({ ok: true });
    expect(post).toHaveBeenCalledWith("/api/migration/names", { body: NAMES });
    expect(migration.status?.onboardingRequired).toBe(false);
  });

  test("a refused confirm reports the field errors and does not re-read", async () => {
    post.mockResolvedValue(refusal(400, { errors: { plantName: "required" } }));
    const { migration } = await fresh(
      (q) =>
        import(/* @vite-ignore */ `./migration.svelte${q}`) as Promise<
          typeof import("./migration.svelte")
        >,
    );
    expect(await migration.confirm(NAMES)).toEqual({
      ok: false,
      errors: { plantName: "required" },
    });
    expect(get).not.toHaveBeenCalled();
  });

  test("a refusal with no body is reported by status", async () => {
    post.mockResolvedValue(refusal(404, ""));
    const { migration } = await fresh(
      (q) =>
        import(/* @vite-ignore */ `./migration.svelte${q}`) as Promise<
          typeof import("./migration.svelte")
        >,
    );
    expect(await migration.confirm(NAMES)).toEqual({ ok: false, message: "404" });
  });

  test("backfill and snooze post, then re-read; a refusal stops short", async () => {
    get.mockResolvedValue({ data: STATUS });
    post.mockResolvedValue({ data: {} });
    const { migration } = await fresh(
      (q) =>
        import(/* @vite-ignore */ `./migration.svelte${q}`) as Promise<
          typeof import("./migration.svelte")
        >,
    );
    expect(await migration.runBackfill()).toBe(true);
    expect(post).toHaveBeenLastCalledWith("/api/migration/backfill");
    await migration.snooze();
    expect(post).toHaveBeenLastCalledWith("/api/migration/notice/snooze");
    expect(get).toHaveBeenCalledTimes(2);
    post.mockResolvedValue(refusal(409));
    expect(await migration.runBackfill()).toBe(false);
    await migration.snooze();
    expect(get).toHaveBeenCalledTimes(2);
  });
});
