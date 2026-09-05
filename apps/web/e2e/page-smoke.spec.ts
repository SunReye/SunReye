/**
 * Every route in the app, opened in a real browser, once.
 *
 * ## Why this exists
 *
 * `routes/(app)/page-shells.test.ts` reads every `+page.svelte` from disk and
 * asserts each one declares a shell shape. That is a claim about markup. It
 * says nothing about whether the page RENDERS — whether its payloads arrive,
 * whether its `$effect`s settle, whether it throws on the way. Twenty-three of
 * the twenty-six pages had never been opened by a test at all: the browser
 * layer covered `/` and `/history` and nothing else, so a settings panel could
 * sit on "Loading…" forever, or a page could boot straight into a console
 * error, and the suite stayed green.
 *
 * So this is the second census: discovered from the same disk scan, one case
 * per page, and four assertions each.
 *
 *  1. the shell `<h1>` reads what the route's `setPageHeader` says it should
 *  2. a KEY SURFACE — one locator that only exists once the route's own
 *     payloads landed. Never the heading (the shell renders that whatever
 *     happens) and never a container that renders empty
 *  3. zero console errors and zero uncaught exceptions
 *  4. `backend.unhandled` is empty — no `/api` call the fixture cannot answer
 *
 * Assertion 4 is why a new endpoint cannot be added without being mocked, and
 * assertion 2 is why mocking it with `null` does not count.
 *
 * ## Adding a page
 *
 * A new `+page.svelte` fails TWO suites: `page-shells.test.ts` (undeclared
 * shape) and the first case here (uncovered by smoke). The second is the one
 * that forces someone to name a mock state and a surface worth asserting.
 *
 * ## First run, before the mock was extended (recorded on purpose)
 *
 * Written and run against `api-mock.ts` as it stood — thirteen GET handlers, no
 * method awareness, no `needsSetup`/`needsProfile`, `metrics` the only topic
 * ever emitted. Verbatim result:
 *
 *   22 failed, 5 passed (5.7m)
 *
 * The five greens were the disk-census case, `/#/history` (already fully
 * mocked), `/#/controls`, `/#/automations` and `/#/login`. The twenty-two reds,
 * by cause:
 *
 *   - `/#/` — surface green, `unhandled` = [/api/weather, /api/cost] and two
 *     console 404s with them. Exactly the failure this census is for: the page
 *     LOOKS fine, and two of its three tiles are silently missing.
 *   - `/#/statistics`, `/#/costs` — "Costs & savings" never appeared:
 *     `statistics-body.svelte` renders nothing at all while `data` is null, and
 *     `/api/statistics/comparison` 404'd.
 *   - `/#/settings` and all fourteen panels — `/api/status` 404'd on every one
 *     of them, and eleven also 404'd their own GET, so the panels sat on
 *     "Loading…" and the surface locator never existed. `/#/settings/sensors`
 *     and `/#/settings/danger` reached their surface (neither needs a payload
 *     the fixture lacked) and failed on the console/`unhandled` pair instead —
 *     which is the pair doing the work for those two.
 *   - `/#/settings/users`, `/#/settings/api-keys` — better-auth admin calls were
 *     swallowed as `null` by the `/api/auth/` catch-all, so both rendered a
 *     load-error toast over an empty table.
 *   - `/#/automations/peak-shaving` — `/api/settings/automations` 404'd, so the
 *     form never got a draft and its switches never rendered.
 *   - `/#/onboarding` — redirected to `/#/login`: `/api/setup-status` was
 *     hardcoded `{ needsSetup: false }` and no option could change it.
 *   - `/#/setup` — redirected to `/#/`, same reason for `/api/profile-status`.
 *   - `/#/system` (since removed — its subsystem panels are the power-flow
 *     nodes' dialogs now, see `node-detail-dialog.spec.ts`) and
 *     `/#/settings/danger` also caught two bugs in THIS spec
 *     rather than in the app: a heading regex that did not match the real
 *     message ("Solar · 2 strings"), and `getByRole("heading", …)` matching by
 *     substring across levels, which collided the shell's `<h1>` with the
 *     section `<h2>` under it. Both are fixed above; the app was fine.
 *
 * The api-mock changes in the same commit are exactly the list above.
 *
 * ## Second pass: the surfaces that were not surfaces (recorded on purpose)
 *
 * Four of the cases above were later shown to be VACUOUS, by sabotage rather
 * than by reading:
 *
 *   - `/#/statistics` and `/#/costs` asserted section HEADINGS.
 *     `statistics-section.svelte` renders those from the registry label the
 *     moment `data` is non-null, so `cost-section.svelte` was replaced with a
 *     script-only component and the prices section was forced off entirely —
 *     and both cases stayed green. They now assert what each section body put
 *     on the screen: the band rows, the cost chart panel, a price tile, a
 *     record tile.
 *   - `/#/` asserted `texts.length >= 4` over an unscoped readout selector.
 *     Four is met by the power-flow diagram alone, so `weather = null` and an
 *     `{#if false}` on the EV card left it green — with `fixture.WEATHER` and
 *     the whole `evcc` backfill asserted by nothing, anywhere. It now names all
 *     three, and counts the diagram's readouts exactly (TESTING.md: numbers are
 *     ratios, never floors).
 *   - `/#/automations` asserted a link the page builds from literals. It now
 *     asserts the run-state badge, which is the only live thing on it.
 *   - `/#/automations/peak-shaving` asserted the form switch only, while the
 *     decision charts under it were drawing zero rows off a fixture whose
 *     `history` was not `DecisionPoint`-shaped. It now asserts both plots
 *     mounted.
 *
 * The absent-payload half of those questions — what the page does when weather,
 * prices or EVCC are switched OFF — is `e2e/payload-states.spec.ts`, because
 * each case needs its own backend.
 */

import { expect, type Page, test } from "@playwright/test";
import { CHARTABLE_METRIC_COUNT, MANIFEST } from "./support/api-mock";
import { metricCards } from "./support/history";
import { SELECTORS } from "./support/perf";
import {
  discoverPageFiles,
  expectHeading,
  hashUrlFor,
  openPage,
  type OpenedPage,
  type OpenPageOptions,
  evChargerCard,
  POWER_FLOW_READOUTS,
  powerFlowReadouts,
} from "./support/open-page";

type SmokeRoute = {
  /**
   * The page file, relative to `src/routes` — the same key
   * `page-shells.test.ts` uses, so the two tables diff against each other.
   * The URL is DERIVED from it; storing both would let them disagree.
   */
  file: string;
  /** Mock deltas. `live: false` for the routes that never lease the socket. */
  open?: OpenPageOptions;
  /** The shell header this route sets, resolved from `messages/en.json`. */
  h1: string;
  /** Where a redirect stub lands. The redirect IS the surface for those. */
  landsOn?: string;
  /**
   * The one locator that only exists once this route's payloads arrived.
   * Runs after the h1 assertion and before the console/unhandled pair.
   */
  surface: (page: Page, opened: OpenedPage) => Promise<void>;
};

/**
 * A SECTION heading — `layout/section.svelte` renders every one as an `<h2>`.
 *
 * Both qualifiers are load-bearing. Without `level: 2` the shell's own `<h1>`
 * collides on every settings panel whose section repeats its title ("API Keys"
 * / "API keys", "Danger Zone" / "Danger zone"). Without `exact` the name match
 * is a SUBSTRING, so "Records" also matched "All-time daily records" — a strict
 * mode violation that reads like the page is broken when it is not.
 */
const heading = (page: Page, name: string | RegExp) =>
  expect(
    page.getByRole("heading", { level: 2, name, exact: typeof name === "string" }),
  ).toBeVisible();

/**
 * The section CARD whose own `<h2>` reads `title` — `layout/section.svelte`
 * renders every one as a `<section>` wrapping that heading.
 *
 * `.last()` because sections nest: the "Import by tariff band" card sits inside
 * the "Costs & savings" card, so both `<section>`s contain the inner heading
 * and the innermost (last in document order) is the one meant.
 *
 * Needed because the figures worth asserting are not unique on the page — €2.52
 * is both a tile sub-line and a band row — and a `.first()` on an ambiguous
 * string is how an assertion quietly stops pointing at its subject.
 */
const sectionNamed = (page: Page, title: string) =>
  page
    .locator("section")
    .filter({ has: page.getByRole("heading", { level: 2, name: title, exact: true }) })
    .last();

const switchNamed = (page: Page, name: string | RegExp) =>
  expect(page.getByRole("switch", { name })).toBeVisible();

/**
 * `OptionSelect`'s trigger. bits-ui renders it as a plain `button` whose label
 * is the CURRENT value, so this is how a spec asserts what a picker is showing.
 */
const picker = (page: Page, label: string) =>
  expect(page.getByRole("button", { name: label, exact: true })).toBeVisible();

const ROUTES: readonly SmokeRoute[] = [
  {
    file: "(app)/+page.svelte",
    h1: "Overview",
    // All THREE things this page is: the diagram, the weather tile and the EV
    // card. The two tiles self-hide on a null payload, which is precisely why
    // they need naming here — with only the diagram asserted, forcing
    // `weather = null` and `{#if false}` on the EV card left this case green.
    surface: async (page, opened) => {
      const nodes = powerFlowReadouts(page);
      await expect(nodes.first()).toBeVisible();
      for (let i = 0; i < 3; i++) await opened.backend.pushMetrics();
      // The nodes render a literal em dash until a frame is applied, which is
      // the outage `shell-lease-loop.spec.ts` was written for.
      await expect(nodes).toHaveCount(POWER_FLOW_READOUTS);
      for (const text of await nodes.allTextContents()) expect(text).toMatch(/\d/);

      // Weather: `isReadableWeather` renders NOTHING for a partial payload, so
      // the temperature and the configured place together are the proof that
      // /api/weather landed whole.
      await expect(page.getByText("18°C")).toBeVisible();
      await expect(page.getByText("Berlin")).toBeVisible();

      // The EV card exists only once the `evcc` topic delivered a reachable
      // state with a loadpoint — the subscribe-time backfill this mock grew.
      const ev = evChargerCard(page);
      await expect(ev).toBeVisible();
      await expect(ev).toContainText("12.4 kWh");
      await expect(ev).toContainText("Charging");
    },
  },
  {
    file: "(app)/history/+page.svelte",
    h1: "History",
    surface: async (page) => {
      await expect(metricCards(page)).toHaveCount(CHARTABLE_METRIC_COUNT);
    },
  },
  {
    file: "(app)/statistics/+page.svelte",
    h1: "Statistics",
    // The section headings are NOT the surface. `statistics-section.svelte`
    // renders every one of them from the registry label the moment `data` is
    // non-null, so they survive their own body being deleted: emptying
    // `cost-section.svelte` to a script-only component and forcing the prices
    // section off left `heading("Costs & savings")` green. What each section
    // actually PUT ON THE SCREEN is what this asserts.
    surface: async (page) => {
      await expect(page.getByText("Loading costs…")).toBeHidden();
      // Cost body: the band breakdown is rendered straight from the comparison
      // payload's `byBand`, and the chart panel only exists once
      // /api/cost/series answered with a non-zero series (`costHasData`).
      await heading(page, "Costs & savings");
      const bands = sectionNamed(page, "Import by tariff band");
      await expect(bands).toContainText("Standard");
      await expect(bands).toContainText("8.4 kWh");
      await expect(bands).toContainText("€2.52");
      await expect(sectionNamed(page, "Total cost")).toBeVisible();
      // Prices body: capability-gated on `spotStats.available`, so a broken
      // /api/statistics/prices deletes the whole section silently — asserting
      // its tiles is the only thing that notices.
      await heading(page, "Spot prices");
      await expect(page.getByText("Negative hours")).toBeVisible();
      // Records body: its own /api/statistics/records fetch, nothing else.
      await heading(page, "Records");
      await expect(page.getByText("Best production day")).toBeVisible();

      // And the toolbar carries no CONNECTION indicator. The dot was removed:
      // one socket now serves every feed, so a lit dot here said "connected"
      // about the app rather than about this page, beside figures that are a
      // finished window's totals. Matched on that indicator's own element, not
      // on the word "Live" — the period navigator's live pill is a different
      // claim (this window still includes now) and it must keep saying so on
      // the current period.
      await expect(page.locator("[data-slot=live-dot]")).toHaveCount(0);
    },
  },
  {
    file: "(app)/costs/+page.svelte",
    h1: "Statistics",
    landsOn: "/#/statistics",
    // The redirect target is the same page, so this case's job is the redirect
    // plus one payload-fed value proving it landed on a LOADED statistics page
    // rather than on its loading skeleton.
    surface: async (page) => {
      await heading(page, "Costs & savings");
      await expect(sectionNamed(page, "Import by tariff band")).toContainText("Standard");
    },
  },
  {
    file: "(app)/controls/+page.svelte",
    h1: "Controls",
    // The committed Deye manifest has eight writable settings metrics, so the
    // documented `Nothing writable` empty state would be a bug here.
    surface: async (page) => {
      await heading(page, "Inverter settings");
      await expect(page.getByText("Max battery charge current")).toBeVisible();
    },
  },
  {
    file: "(app)/automations/+page.svelte",
    h1: "Automations",
    // The link itself proves nothing: the page builds its list from literals,
    // so `getByRole("link", …)` renders whether or not the automations stream
    // ever arrived. The run-state badge is the only live thing here — it reads
    // `peakShaving?.state ?? 'disabled'`, so "Idle" means the topic was granted,
    // backfilled and parsed, and "Disabled" is what a broken stream looks like.
    surface: async (page) => {
      const card = page.getByRole("link", { name: /PV peak shaving/ });
      await expect(card).toBeVisible();
      await expect(card).toContainText("Idle");
      await expect(card).toContainText("Mode: Maximize exports");
    },
  },
  {
    file: "(app)/automations/peak-shaving/+page.svelte",
    h1: "PV peak shaving & forecast charging",
    // The status card degrades gracefully on a null stream, so it cannot be the
    // probe. The form's switch only exists once `/api/settings/automations`
    // resolved AND the master flag is on.
    surface: async (page) => {
      await expect(page.getByRole("link", { name: "All automations" })).toBeVisible();
      await switchNamed(page, "Enable peak shaving");
      // The decision charts are the stream's payload rendered. `toDecisionRows`
      // windows the ring off `newest.t`, so a history whose points are not
      // `DecisionPoint`s yields zero rows and this section shows its empty
      // state instead — which is exactly what the fixture used to produce.
      const charts = sectionNamed(page, "Decision history");
      await expect(charts.getByText("Nothing recorded yet", { exact: false })).toBeHidden();
      // Both plots MOUNTED, not both labels present: the labels are rendered by
      // the section, the layerchart roots only exist once `rows` is non-empty.
      await expect(charts.locator(SELECTORS.chart)).toHaveCount(2);
    },
  },
  {
    file: "(app)/settings/+page.svelte",
    h1: "Inverter",
    landsOn: "/#/settings/inverter",
    surface: async (page) => {
      await heading(page, "Connection");
    },
  },
  {
    file: "(app)/settings/inverter/+page.svelte",
    h1: "Inverter",
    surface: async (page) => {
      await heading(page, "Connection");
      await expect(page.getByLabel("Host")).toHaveValue("10.0.0.5");
    },
  },
  {
    file: "(app)/settings/sensors/+page.svelte",
    h1: "Sensors",
    // The heading alone also renders over the `No sensors available yet.`
    // branch; a toggle proves the manifest AND the ui prefs both arrived.
    surface: async (page) => {
      await heading(page, "Sensor visibility");
      await expect(page.getByRole("switch").first()).toBeVisible();
    },
  },
  {
    file: "(app)/settings/mqtt/+page.svelte",
    h1: "MQTT & Home Assistant",
    surface: async (page) => {
      await heading(page, "MQTT broker");
      await expect(page.getByLabel("Broker URL")).toHaveValue("mqtt://localhost:1883");
    },
  },
  {
    file: "(app)/settings/display/+page.svelte",
    h1: "Display",
    // The only panel whose payload the fixture already served, so assert the
    // VALUE: a heading here would pass against any config at all.
    surface: async (page) => {
      await heading(page, "Date & time");
      await picker(page, "24-hour (14:05)");
    },
  },
  {
    file: "(app)/settings/tariff/+page.svelte",
    h1: "Tariff",
    surface: async (page) => {
      await heading(page, "General");
      await expect(page.getByLabel("Currency")).toHaveValue("EUR");
    },
  },
  {
    file: "(app)/settings/prices/+page.svelte",
    h1: "Day-ahead prices",
    // The zone picker's items come from the SELECTED PROVIDER's zone list, so a
    // populated zone trigger proves `/api/prices/providers` landed too — a
    // heading assertion would pass against an empty provider list.
    surface: async (page) => {
      await switchNamed(page, "Fetch day-ahead prices");
      await picker(page, "DE-LU");
    },
  },
  {
    file: "(app)/settings/weather/+page.svelte",
    h1: "Weather & Forecast",
    surface: async (page) => {
      await heading(page, "Weather");
      await expect(page.getByLabel("Latitude")).toHaveValue("52.52");
    },
  },
  {
    file: "(app)/settings/access/+page.svelte",
    h1: "Access",
    // `access-form.svelte` shows `Loading…` until `publicDashboard !== null`,
    // so the switch is the payload proof.
    surface: async (page) => {
      await switchNamed(page, /Public read-only dashboard/);
    },
  },
  {
    file: "(app)/settings/automations/+page.svelte",
    h1: "Automations",
    // Deliberately NOT the section heading: it is the same string as the h1.
    surface: async (page) => {
      await switchNamed(page, "Enable automations");
    },
  },
  {
    file: "(app)/settings/profiles/+page.svelte",
    h1: "Profiles",
    // The section renders over an empty list, so the rows naming the fixture
    // profiles are what make this non-vacuous. TWO of them, because
    // `grouped-profile-list.svelte` pins the active profile above the list and
    // then groups the REST by manufacturer — with one installed profile the
    // whole grouping is skipped for its "no other profiles" empty state, which
    // is the shape this fixture had.
    surface: async (page) => {
      await heading(page, "Installed profiles");
      const installed = sectionNamed(page, "Installed profiles");
      await expect(installed).toContainText(MANIFEST.name);
      await expect(installed).toContainText("Sungrow SH10RT");
    },
  },
  {
    file: "(app)/settings/users/+page.svelte",
    h1: "Users",
    // The one panel that goes through `authClient.admin.*` rather than
    // `api.api` — swallowing those as `null` used to leave a load-error toast
    // and an empty table, which no heading assertion would have caught.
    surface: async (page) => {
      await expect(page.getByRole("row").filter({ hasText: "e2e@example.com" })).toBeVisible();
    },
  },
  {
    file: "(app)/settings/api-keys/+page.svelte",
    h1: "API Keys",
    surface: async (page) => {
      await heading(page, "API keys");
      await expect(page.getByRole("row").filter({ hasText: "Home Assistant" })).toBeVisible();
    },
  },
  {
    file: "(app)/settings/logs/+page.svelte",
    h1: "Logs",
    // The viewer renders its shell with zero lines, and the server-level picker
    // only appears once `/api/settings/logging` resolved. Both, then.
    surface: async (page, opened) => {
      await heading(page, "Server logs");
      await opened.backend.pushLogs();
      await expect(page.getByText("poll ok").first()).toBeVisible();
      await expect(page.getByText("Server level")).toBeVisible();
    },
  },
  {
    file: "(app)/settings/danger/+page.svelte",
    h1: "Danger Zone",
    // The only panel with no GET of its own, so the heading is available
    // immediately and proves nothing. The disabled confirm button does.
    surface: async (page) => {
      await heading(page, "Danger zone");
      await page.getByRole("button", { name: "Reset all data…" }).click();
      await expect(page.getByRole("button", { name: "Delete everything" })).toBeDisabled();
    },
  },
  {
    file: "login/+page.svelte",
    // Outside `(app)`: its own AuthShell h1, no shell, no gate, no socket.
    open: { live: false, role: null, publicDashboard: true },
    h1: "SunReye",
    surface: async (page) => {
      await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
      await expect(page.getByLabel("Email")).toBeVisible();
      // publicDashboard:true — the way into the read-only workspace is offered.
      await expect(page.getByRole("link", { name: "View public dashboard" })).toBeVisible();
    },
  },
  {
    file: "onboarding/+page.svelte",
    // `needsSetup:false` bounces this route straight to /#/login.
    open: { live: false, role: null, needsSetup: true },
    h1: "Welcome to SunReye",
    // The sign-UP form carries a Name field; the sign-in form does not. That is
    // the one locator that tells the two apart.
    surface: async (page) => {
      await expect(page.getByText("Create the administrator")).toBeVisible();
      await expect(page.getByLabel("Name")).toBeVisible();
      await expect(page.getByRole("button", { name: "Create account" })).toBeVisible();
    },
  },
  {
    file: "setup/+page.svelte",
    // Admin exists, no active profile. `needsSetup` must stay false or the
    // page's own `firstRunGate()` bounces it to /#/onboarding.
    open: { live: false, needsProfile: true },
    h1: "Set up your inverter",
    surface: async (page) => {
      await heading(page, "Select a profile");
      await expect(page.getByText(MANIFEST.name).first()).toBeVisible();
      await expect(page.getByRole("button", { name: "Select", exact: true }).first()).toBeVisible();
    },
  },
];

// The point of scanning disk instead of listing files: a route added without a
// smoke case lands here, not in an incident. Not a browser test — it runs
// first, in milliseconds, and names the missing entry.
test("every page in src/routes has a smoke case", () => {
  expect(discoverPageFiles()).toEqual(ROUTES.map((r) => r.file).sort());
});

// Playwright has no `test.each`; a `for` over the table is the idiom.
for (const route of ROUTES) {
  const url = hashUrlFor(route.file);
  test(`${url} renders`, async ({ page }) => {
    const opened = await openPage(page, url, route.open);

    if (route.landsOn)
      await expect(page).toHaveURL(new RegExp(`${route.landsOn.replace(/[/#]/g, "\\$&")}$`));
    await expectHeading(opened, route.h1);
    await route.surface(page, opened);

    // Both AFTER the surface assertion, on purpose (TESTING.md, "Don't wait for
    // a thing your assertion is about"): a missing stub then reads as a named
    // path rather than as a page stuck behind its first-run gate.
    expect(opened.consoleErrors).toEqual([]);
    expect(opened.backend.unhandled).toEqual([]);
  });
}
