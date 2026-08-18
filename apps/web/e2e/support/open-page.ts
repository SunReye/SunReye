/**
 * Opening ANY route, the way `history.ts` opens /history.
 *
 * `openHistory` proved the shape works but it only knows one URL. The route
 * census (`page-smoke.spec.ts`) needs the same three steps for twenty-six of
 * them — mock, goto, settle — plus the two things every route case asserts and
 * no spec should re-derive: what a console error is, and when it started being
 * recorded.
 *
 * Deliberately a NEW module rather than more exports on `support/history.ts`:
 * that file is the /history vocabulary (`metricCards`, `selectRange`) and other
 * work edits it concurrently.
 *
 * Three rules are baked in here because getting them wrong turns a real failure
 * into a twenty-second timeout:
 *
 *  1. **Mock before goto.** `mockBackend` installs `page.route`; called after
 *     the navigation it mocks nothing and the shell sits behind its first-run
 *     gate forever.
 *  2. **Listen before goto.** A console error thrown during boot is the most
 *     interesting one there is, and it is emitted before `goto` resolves.
 *  3. **`waitForLive` is not universal.** /login, /onboarding and /setup render
 *     outside `(app)`, never lease the socket, and would time out waiting for a
 *     `metrics` subscription that is never coming. Those routes pass
 *     `live: false`.
 */

import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, type Locator, type Page } from "@playwright/test";
import { EVCC_STATE } from "./api-fixtures";
import { type BackendOptions, mockBackend, type MockBackend } from "./api-mock";
import { SELECTORS } from "./perf";

export interface OpenPageOptions extends BackendOptions {
  /**
   * Wait for the app shell to take its `metrics` lease before returning.
   * Default `true`. Set `false` for the three routes outside `(app)` — they
   * have no shell and no socket.
   */
  live?: boolean;
}

export interface OpenedPage {
  /** The fake backend, for request counts, `pushMetrics` and `unhandled`. */
  readonly backend: MockBackend;
  /**
   * Console errors and uncaught page errors, oldest first, recorded from before
   * the first navigation. A smoke case asserts this is empty: a page that
   * renders its heading while throwing on every frame is not "working".
   */
  readonly consoleErrors: readonly string[];
  /**
   * The page's own `<h1>`. In `(app)` that is the shell header
   * (`(app)/+layout.svelte`), fed by the `pageHeader` store; the three auth
   * routes render their own. One locator either way.
   */
  readonly heading: Locator;
  /** Live numeric readouts — power-flow nodes, KPI values. */
  readonly liveReadouts: Locator;
}

/**
 * Noise this browser emits that is not the app's doing.
 *
 * Kept to an explicit, short list: a broad filter would swallow the very thing
 * the assertion exists for. Every entry needs a reason.
 */
const IGNORED_CONSOLE = [
  // Chromium logs a failed favicon fetch on every route; the dev server has no
  // favicon and the app never asks for one.
  /favicon/i,
  // Vite's dev client narrates its own connection — and ONLY that. A blanket
  // `/^\[vite\]/` was the filter here, which is the one thing this list must
  // never do: Vite reports a failed transform, a missing import and an HMR
  // failure on the same prefix, so "this page did not build" was being dropped
  // out of the very assertion that exists to catch it.
  /^\[vite\] (connecting\.\.\.|connected\.)$/,
] as const;

function isNoise(text: string): boolean {
  return IGNORED_CONSOLE.some((pattern) => pattern.test(text));
}

/**
 * Mock the backend, open `url`, and wait until the route has settled.
 *
 * `url` is the hash URL exactly as the address bar shows it (`/#/settings/mqtt`)
 * — this app is a hash router, so a path without the `#` loads the shell and
 * lands on `/`.
 */
export async function openPage(
  page: Page,
  url: string,
  options: OpenPageOptions = {},
): Promise<OpenedPage> {
  const { live = true, ...backendOptions } = options;
  const consoleErrors: string[] = [];

  // Before `goto`, both of them: the mock so the first boot call is answered,
  // the listeners so a boot-time throw is recorded rather than missed.
  const backend = await mockBackend(page, backendOptions);
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (!isNoise(text)) consoleErrors.push(text);
  });
  page.on("pageerror", (error) => {
    consoleErrors.push(`pageerror: ${error.message}`);
  });

  await page.goto(url);
  if (live) await backend.waitForLive();

  return {
    backend,
    get consoleErrors() {
      return consoleErrors;
    },
    heading: page.getByRole("heading", { level: 1 }),
    liveReadouts: page.locator(SELECTORS.liveReadout),
  };
}

/**
 * Live readouts the power-flow diagram draws for the committed Deye manifest:
 * one per graph node (`power-graph.ts`, including the EVCC charger the `evcc`
 * topic supplies) plus the hub's own self-use figure.
 *
 * An EXACT count, so it is a ratio and not a floor. Two specs used to accept
 * "at least four" — and four is met by the diagram alone, so the tiles beside
 * it could be deleted outright, or six of these ten could vanish, with both
 * cases still green. This number moves when the graph or the manifest moves,
 * and the failure names which.
 */
export const POWER_FLOW_READOUTS = 10;

/**
 * The power-flow diagram's OWN live readouts, on the overview.
 *
 * `SELECTORS.liveReadout` is a class selector that sixteen components wear, and
 * once the weather, energy and EVCC payloads were all mocked the unscoped
 * version also swept the weather tile, the daily-energy headline and the EV
 * card. That is fine for "every readout holds a digit" — but it made
 * `readouts.first()` a power-flow node only because `(app)/+page.svelte`
 * happens to put `<PowerFlow>` before `<WeatherTile>`, so a column reorder
 * would have emptied the assertion with nothing going red.
 *
 * Scoped through the section's own (screen-reader) heading instead, which is
 * the diagram's name rather than its position.
 */
export function powerFlowReadouts(page: Page): Locator {
  return page
    .locator("section")
    .filter({ has: page.getByRole("heading", { level: 2, name: "Power flow", exact: true }) })
    .locator(SELECTORS.liveReadout);
}

/**
 * The overview's EV charger tile, as a whole.
 *
 * Scoped rather than matched by text: "Charging" is also the state caption of
 * every power-flow node that happens to be charging, so `getByText("Charging")`
 * is a strict-mode violation on a good day and an assertion about the wrong
 * element on a bad one. The loadpoint title comes from the fixture, so a
 * renamed loadpoint moves both sides together.
 *
 * An admin gets the tile as a dialog trigger (`ev-charger-card.svelte`), which
 * is the role every spec here runs as.
 */
export function evChargerCard(page: Page): Locator {
  const title = EVCC_STATE.loadpoints[0].title;
  return page.getByRole("button", { name: new RegExp(`^${title}`) });
}

/**
 * Assert the shell header (or the auth shell's own `<h1>`) reads `title`.
 *
 * Exact, not a substring: "Automations" and "Automations" are the same string
 * on two different routes, but "Statistics" quietly matching "Statistics
 * (beta)" is how a header regression ships green.
 */
export async function expectHeading(opened: OpenedPage, title: string): Promise<void> {
  await expect(opened.heading).toHaveText(title);
}

/**
 * Every `+page.svelte` under `src/routes`, relative to it and sorted.
 *
 * The WHOLE tree, not just `(app)`: `routes/(app)/page-shells.test.ts` roots at
 * `(app)` and therefore has no opinion about /login, /onboarding and /setup —
 * which is exactly why those three had no coverage of any kind. Two callers
 * need this list and must not disagree: the smoke census (a page with no case
 * fails) and the Vite warm-up (a page nobody warmed pays a dep-optimizer full
 * reload inside someone's measured run).
 *
 * A plain recursive walk rather than `fs.globSync`, which is still flagged
 * experimental on the Node the Playwright runner uses.
 */
export function discoverPageFiles(): string[] {
  return walk(fileURLToPath(new URL("../../src/routes", import.meta.url)));
}

function walk(dir: string, prefix = ""): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) found.push(...walk(`${dir}/${entry.name}`, `${prefix}${entry.name}/`));
    else if (entry.name === "+page.svelte") found.push(`${prefix}${entry.name}`);
  }
  return found.sort();
}

/**
 * The range picker's popover, opened, with its calendar grid on screen.
 *
 * Every route carrying a range control (/history, /statistics) renders the same
 * `preset-range-picker.svelte` behind a bits-ui popover, so the gestures — click
 * the trigger, wait for the portalled content to paint — belong here rather than
 * in each spec.
 *
 * Days are addressed by `data-value` (bits-ui writes the ISO date on every
 * `[data-bits-day]`), never by their visible number: "16" also matches the 16th
 * of a neighbouring month bleeding into the grid, and the year dropdown's
 * options besides.
 *
 * Deliberately NOT on `support/history.ts`, which is the /history vocabulary and
 * is edited concurrently by other work.
 */
export interface OpenedRangePicker {
  /** One day cell, by ISO date (`2026-08-16`). */
  day(isoDate: string): Locator;
  /** The day bits-ui marked `data-today`. Exactly one per grid. */
  readonly today: Locator;
  /** Every day cell in the visible grid, outside-month days included. */
  readonly days: Locator;
}

export function rangePicker(page: Page): OpenedRangePicker {
  const days = page.locator("[data-bits-day]");
  return {
    day: (isoDate) => page.locator(`[data-bits-day][data-value="${isoDate}"]`),
    today: days.and(page.locator("[data-today]")),
    days,
  };
}

/**
 * Open the range picker on the current page and return its day locators.
 *
 * The trigger is matched by `data-popover-trigger` — the picker is the only
 * popover a range toolbar carries, and matching it by its label would mean
 * re-deriving in the spec the very range label the picker renders.
 */
export async function openRangePicker(page: Page): Promise<OpenedRangePicker> {
  await page.locator("[data-popover-trigger]").first().click();
  const picker = rangePicker(page);
  await expect(picker.today).toBeVisible();
  return picker;
}

/**
 * `(app)/settings/mqtt/+page.svelte` → `/#/settings/mqtt`.
 *
 * Derived, never stored beside the file path: a table carrying both would let
 * them drift, and the URL is the half nobody checks. `(group)` segments are
 * SvelteKit organisation and are not part of the path; the empty remainder is
 * the root route.
 */
export function hashUrlFor(file: string): string {
  const path = file
    .replace(/\+page\.svelte$/, "")
    .split("/")
    .filter((segment) => segment.length > 0 && !/^\(.*\)$/.test(segment))
    .join("/");
  return `/#/${path}`;
}
