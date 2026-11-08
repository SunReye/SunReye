import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { coreCapabilities } from "$lib/capabilities.svelte";
import * as m from "$lib/paraglide/messages";
import { SETTINGS_ROUTES, message } from "./nav-routes";
import SettingsNav from "./settings-nav.svelte";

vi.mock("$env/dynamic/public", () => ({ env: {} }));
const get = vi.hoisted(() => vi.fn());
vi.mock("$lib/core-api", () => ({ core: { GET: get } }));
const goto = vi.hoisted(() => vi.fn());
vi.mock("$app/navigation", () => ({ goto }));

/** What a core that serves no optional area reports; each test turns on what it serves. */
const NONE = {
  history: false,
  statistics: false,
  controls: false,
  automations: false,
  restart: false,
  profileSources: false,
  integrations: false,
  pvAndBattery: false,
  pricesAndCosts: false,
  statisticsHeatmap: false,
  evccCommands: false,
  customCharts: false,
  logging: false,
  dataReset: false,
};

async function serving(served: Partial<typeof NONE>) {
  get.mockResolvedValue({ data: { ...NONE, ...served } });
  await coreCapabilities.load();
}

beforeEach(() => {
  // No answer yet: every area is offered, as before the core has spoken.
  get.mockRejectedValue(new Error("no core"));
});

afterEach(async () => {
  await page.viewport(1280, 800);
  get.mockReset();
  goto.mockReset();
  await coreCapabilities.load();
});

/** The rail on a laptop — the phone strip is `md:hidden`, so only one nav is visible. */
const rail = () => page.getByRole("navigation", { name: m.nav_settings() });

describe("the settings rail", () => {
  test("links every visible panel in the route table, and only those", async () => {
    render(SettingsNav, { isAdmin: true, current: "/settings/devices" });
    await expect.element(rail()).toBeVisible();

    // The rail renders the table the shell header reads: a panel with a link
    // here also has a title there, and a table entry that stops rendering is red.
    const expected = SETTINGS_ROUTES.filter((r) => !r.hidden).map((r) => `#${r.href}`);
    const hrefs = rail()
      .getByRole("link")
      .elements()
      .map((a) => new URL(a.getAttribute("href")!, location.href).hash);
    expect(hrefs.sort()).toEqual(expected.sort());
  });

  test("marks the panel being viewed as the current page", async () => {
    render(SettingsNav, { isAdmin: true, current: "/settings/display" });
    await expect.element(rail()).toBeVisible();
    const current = rail().element().querySelectorAll("a[aria-current=page]");
    expect([...current].map((a) => a.textContent?.trim())).toEqual([m.settings_tab_display()]);
  });

  test("a viewer who is not an admin is offered no admin panel", async () => {
    render(SettingsNav, { isAdmin: false, current: "/settings/devices" });
    await expect.element(rail()).toBeVisible();
    const admin = SETTINGS_ROUTES.filter((r) => r.group === "admin" && !r.hidden);
    expect(admin.length).toBeGreaterThan(0);
    for (const route of admin) {
      const name = message(route.titleKey);
      expect(rail().getByRole("link", { name, exact: true }).elements()).toHaveLength(0);
    }
  });
});

/** Tab label -> the capability that gates it. */
const GATED = [
  ["logs", "logging"],
  ["danger", "dataReset"],
] as const;
const UNGATED = SETTINGS_ROUTES.filter((r) => !r.hidden && !GATED.some(([id]) => id === r.id));
const tab = (id: string) => {
  const route = SETTINGS_ROUTES.find((r) => r.id === id)!;
  return rail().getByRole("link", { name: message(route.titleKey), exact: true });
};

describe("the settings rail follows the core's capabilities", () => {
  test.each(GATED)("%s is hidden when the core does not serve %s", async (id) => {
    await serving({});
    render(SettingsNav, { isAdmin: true, current: "/settings/devices" });
    await expect.element(rail()).toBeVisible();
    expect(tab(id).elements()).toHaveLength(0);
  });

  test.each(GATED)("%s is shown when the core serves %s", async (id, capability) => {
    await serving({ [capability]: true });
    render(SettingsNav, { isAdmin: true, current: "/settings/devices" });
    await expect.element(rail()).toBeVisible();
    expect(tab(id).elements()).toHaveLength(1);
  });

  test("a capability opens only its own tabs", async () => {
    await serving({ logging: true });
    render(SettingsNav, { isAdmin: true, current: "/settings/devices" });
    await expect.element(rail()).toBeVisible();
    expect(tab("logs").elements()).toHaveLength(1);
    for (const id of ["danger"]) {
      expect(tab(id).elements()).toHaveLength(0);
    }
  });

  test("the panels no capability gates show on a core that serves nothing optional", async () => {
    await serving({});
    render(SettingsNav, { isAdmin: true, current: "/settings/devices" });
    await expect.element(rail()).toBeVisible();
    for (const route of UNGATED) expect(tab(route.id).elements()).toHaveLength(1);
  });

  test("the phone strip drops a gated tab as well", async () => {
    await page.viewport(390, 844);
    await serving({});
    render(SettingsNav, { isAdmin: true, current: "/settings/devices" });
    const strip = rail();
    await expect.element(strip).toBeVisible();
    expect(
      strip.getByRole("link", { name: message("settings_tab_danger"), exact: true }).elements(),
    ).toHaveLength(0);
  });
});

describe("a gated panel opened by its URL", () => {
  test("lands on the first visible panel", async () => {
    await serving({});
    render(SettingsNav, { isAdmin: true, current: "/settings/danger" });
    await vi.waitFor(() => expect(goto).toHaveBeenCalledTimes(1));
    expect(String(goto.mock.calls[0]![0])).toMatch(/#\/settings\/devices$/);
    expect(goto.mock.calls[0]![1]).toEqual({ replaceState: true });
  });

  test("a drilldown under a gated panel lands there too", async () => {
    await serving({});
    render(SettingsNav, { isAdmin: true, current: "/settings/integrations/mqtt-1" });
    await vi.waitFor(() => expect(goto).toHaveBeenCalledTimes(1));
  });

  test("stays put when the core serves the panel", async () => {
    await serving({ dataReset: true });
    render(SettingsNav, { isAdmin: true, current: "/settings/danger" });
    await expect.element(rail()).toBeVisible();
    expect(goto).not.toHaveBeenCalled();
  });

  test("stays put while the core has not answered yet", async () => {
    render(SettingsNav, { isAdmin: true, current: "/settings/danger" });
    await expect.element(rail()).toBeVisible();
    expect(goto).not.toHaveBeenCalled();
  });

  test("an ungated panel is never redirected", async () => {
    await serving({});
    render(SettingsNav, { isAdmin: true, current: "/settings/plant" });
    await expect.element(rail()).toBeVisible();
    expect(goto).not.toHaveBeenCalled();
  });
});

test("on a phone the panels are one row that swipes to its last tab", async () => {
  await page.viewport(390, 844);
  render(SettingsNav, { isAdmin: true, current: "/settings/devices" });
  await expect.element(rail()).toBeVisible();
  const strip = rail().element();
  // More tabs than fit, and the last of them is reached by swiping the row —
  // not by scrolling the whole page sideways, and not lost past a clipped edge.
  const links = rail().getByRole("link").elements();
  const last = links.at(-1)!;
  expect(last.getBoundingClientRect().left).toBeGreaterThan(390);
  strip.scrollLeft = strip.scrollWidth;
  await expect.poll(() => last.getBoundingClientRect().right).toBeLessThanOrEqual(390);
  const tops = new Set(links.map((a) => Math.round(a.getBoundingClientRect().top)));
  expect(tops.size).toBe(1);
});
