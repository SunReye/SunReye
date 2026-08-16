/**
 * The settings route table is the single source for both the nav rail and the
 * shell header.
 *
 * Before this, `settings/+layout.svelte` set one static "Settings" title for the
 * whole area, so the header read "Settings" on /settings/mqtt, /settings/users
 * and /settings/danger alike — fourteen panels, one label, and no page ever
 * called `setPageHeader`. Adding a per-page call to each of the fourteen would
 * have produced a fifteenth panel with no title at all, so the titles come from
 * the table the nav already renders.
 */

import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as m from "$lib/paraglide/messages";
import { SETTINGS_ROUTES, settingsHeaderFor } from "./nav-routes";

const DIR = fileURLToPath(new URL(".", import.meta.url));
const source = async (file: string) => await Bun.file(DIR + file).text();

const messages = (await Bun.file(
  fileURLToPath(new URL("../../../../messages/en.json", import.meta.url)),
).json()) as Record<string, string>;
const bundles = m as unknown as Record<string, unknown>;
const navSource = await source("settings-nav.svelte");
const layoutSource = await source("+layout.svelte");

/** Panel directories on disk — the ground truth the table is checked against. */
const panelDirs = readdirSync(DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();

describe("settings route table", () => {
  // Orphans in either direction: a panel shipped without a table entry gets the
  // stale area-wide header, and a table entry with no panel puts a nav link on
  // a route that 404s.
  test("covers every panel on disk, and invents none", () => {
    expect(SETTINGS_ROUTES.map((r) => r.id).sort()).toEqual(panelDirs);
  });

  test("each id addresses its own route", () => {
    // `href` is a Kit `Pathname`, so compare as plain strings.
    for (const route of SETTINGS_ROUTES) {
      expect(String(route.href)).toBe(`/settings/${route.id}`);
    }
  });

  // The header strings are message KEYS rather than thunks so this test can
  // check them against the catalogue. A thunk that returned a bare English
  // literal would look identical from here — and a bare literal is exactly what
  // the German, Spanish, French and Italian builds would then show.
  test.each(SETTINGS_ROUTES.map((r) => [r.id, r] as const))(
    "%s resolves to a title and a subtitle in the message catalogue",
    (_id, route) => {
      for (const key of [route.titleKey, route.subtitleKey]) {
        expect(messages[key]).toBeString();
        expect(messages[key]).not.toBe("");
        expect(bundles[key]).toBeFunction();
      }
    },
  );

  test("no two panels share a subtitle — a copied entry is a wrong header", () => {
    const subtitles = SETTINGS_ROUTES.map((r) => r.subtitleKey);
    expect(new Set(subtitles).size).toBe(subtitles.length);
  });
});

describe("settingsHeaderFor", () => {
  test("gives each panel its own header", () => {
    const mqtt = settingsHeaderFor("/settings/mqtt");
    const danger = settingsHeaderFor("/settings/danger");
    expect(mqtt?.title()).toBe(messages.settings_tab_mqtt!);
    expect(danger?.title()).toBe(messages.settings_tab_danger!);
    expect(mqtt?.subtitle()).not.toBe(danger?.subtitle());
  });

  // /settings itself only redirects to the first panel; there is no header to
  // show for it, and guessing one would flash the wrong title on the way past.
  test("has nothing for the settings root, an unknown panel, or another area", () => {
    expect(settingsHeaderFor("/settings")).toBeNull();
    expect(settingsHeaderFor("/settings/")).toBeNull();
    expect(settingsHeaderFor("/settings/nope")).toBeNull();
    expect(settingsHeaderFor("/history")).toBeNull();
    expect(settingsHeaderFor("/")).toBeNull();
  });

  // A deeper path under a panel is still that panel, not a miss.
  test("matches a panel's own subroutes to the panel", () => {
    expect(settingsHeaderFor("/settings/users/42")?.title()).toBe(messages.settings_tab_users!);
  });
});

describe("wiring", () => {
  const nav = navSource;
  const layout = layoutSource;

  // The nav rail used to BE the table. If it still holds its own hrefs, the
  // headers above are checked against a copy nobody renders.
  test("the nav rail renders the shared table, holding no route list of its own", () => {
    expect(nav).toContain("SETTINGS_ROUTES");
    expect(nav).not.toMatch(/["']\/settings\//);
  });

  test("the layout drives the shell header off the active route", () => {
    expect(layout).toContain("settingsHeaderFor(current)");
    expect(layout).toMatch(/setPageHeader\(\s*header/);
  });

  // The fallback matters: it is what /settings shows for the instant before the
  // redirect lands, and what a panel added without a table entry would show.
  test("and falls back to the area header when the route has none", () => {
    expect(layout).toContain("m.nav_settings()");
    expect(layout).toContain("m.settings_subtitle()");
  });
});
