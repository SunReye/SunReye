/**
 * The settings route table is the single source for both the nav rail and the
 * shell header.
 *
 * Before this, `settings/+layout.svelte` set one static "Settings" title for the
 * whole area, so the header read "Settings" on /settings/plant, /settings/users
 * and /settings/danger alike — fourteen panels, one label, and no page ever
 * called `setPageHeader`. Adding a per-page call to each of the fourteen would
 * have produced a fifteenth panel with no title at all, so the titles come from
 * the table the nav already renders.
 */

import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as m from "$lib/paraglide/messages";
import { type CapabilityName } from "$lib/capabilities";
import { SETTINGS_ROUTES, gatedAway, railRoutes, settingsHeaderFor } from "./nav-routes";

const DIR = fileURLToPath(new URL(".", import.meta.url));

const messages = (await Bun.file(
  fileURLToPath(new URL("../../../../messages/en.json", import.meta.url)),
).json()) as Record<string, string>;
const bundles = m as unknown as Record<string, unknown>;

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
    const devices = settingsHeaderFor("/settings/devices");
    const danger = settingsHeaderFor("/settings/danger");
    expect(devices?.title()).toBe(messages.settings_tab_devices!);
    expect(danger?.title()).toBe(messages.settings_tab_danger!);
    expect(devices?.subtitle()).not.toBe(danger?.subtitle());
  });

  // The Integrations panel is GONE: its two forms are integration ROWS under
  // their connection on /settings/devices, so the path is not a panel any more
  // and must not resolve to a header of its own.
  test("the retired Integrations path is not a panel", () => {
    expect(settingsHeaderFor("/settings/mqtt")).toBeNull();
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

const offering =
  (...served: CapabilityName[]) =>
  (area: CapabilityName) =>
    served.includes(area);
const ids = (routes: readonly { id: string }[]) => routes.map((r) => r.id);

describe("which panels the core's capabilities leave in the rail", () => {
  test("each gated panel names the one capability it needs", () => {
    const gates = Object.fromEntries(
      SETTINGS_ROUTES.filter((r) => r.capability).map((r) => [r.id, r.capability]),
    );
    expect(gates).toEqual({
      tariff: "pricesAndCosts",
      prices: "pricesAndCosts",
      automations: "automations",
      integrations: "integrations",
      logs: "logging",
      danger: "dataReset",
    });
  });

  test("a core that serves nothing optional keeps the ungated panels, in table order", () => {
    expect(ids(railRoutes(true, offering()))).toEqual([
      "devices",
      "plant",
      "sensors",
      "display",
      "weather",
      "access",
      "profiles",
      "users",
      "api-keys",
    ]);
  });

  test("a core that serves everything keeps every panel the table does not hide", () => {
    const all = offering("pricesAndCosts", "automations", "integrations", "logging", "dataReset");
    expect(ids(railRoutes(true, all))).toEqual(
      SETTINGS_ROUTES.filter((r) => !r.hidden).map((r) => r.id),
    );
  });

  test("a viewer who is not an admin never gets an admin panel, served or not", () => {
    const all = offering("pricesAndCosts", "automations", "integrations", "logging", "dataReset");
    expect(ids(railRoutes(false, all))).toEqual([
      "devices",
      "plant",
      "sensors",
      "display",
      "tariff",
      "prices",
      "weather",
    ]);
  });
});

describe("gatedAway", () => {
  test("is true for a panel whose capability the core does not serve", () => {
    expect(gatedAway("/settings/danger", offering())).toBe(true);
    expect(gatedAway("/settings/danger", offering("logging"))).toBe(true);
    expect(gatedAway("/settings/danger", offering("dataReset"))).toBe(false);
  });

  test("covers a hidden route and a drilldown under a gated panel", () => {
    expect(gatedAway("/settings/integrations", offering())).toBe(true);
    expect(gatedAway("/settings/integrations/mqtt-1", offering())).toBe(true);
    expect(gatedAway("/settings/integrations/mqtt-1", offering("integrations"))).toBe(false);
  });

  test("is false for an ungated panel, the settings root, an unknown path or another area", () => {
    for (const path of ["/settings/plant", "/settings", "/settings/nope", "/history", "/"]) {
      expect(gatedAway(path, offering())).toBe(false);
    }
  });
});
