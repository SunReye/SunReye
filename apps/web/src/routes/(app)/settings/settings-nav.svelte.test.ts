import { afterEach, describe, expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import * as m from "$lib/paraglide/messages";
import { SETTINGS_ROUTES, message } from "./nav-routes";
import SettingsNav from "./settings-nav.svelte";

afterEach(async () => {
  await page.viewport(1280, 800);
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
    render(SettingsNav, { isAdmin: true, current: "/settings/tariff" });
    await expect.element(rail()).toBeVisible();
    const current = rail().element().querySelectorAll("a[aria-current=page]");
    expect([...current].map((a) => a.textContent?.trim())).toEqual([m.settings_tab_tariff()]);
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
