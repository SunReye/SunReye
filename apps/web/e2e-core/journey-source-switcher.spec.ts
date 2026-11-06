/**
 * JOURNEY, against the real core binary: with two devices in service the dashboard reads the plant, the
 * source menu switches it to one device and back, the live tiles and the history chart follow each
 * switch, a saved device survives a reload, and the kiosk view's default dashboard shows the plant's
 * values rather than dashes.
 *
 * Starts from the core the onboarding journey left: its admin and its one device. Each device is pointed
 * at its own simulator, which replays the same case, so a plant figure that sums its members is exactly
 * twice the device's. The added device is retired and the kiosk view switched off in `afterAll`, so the
 * journeys after this one read a one-device plant behind a sign-in.
 */

import type { ChildProcess } from "node:child_process";
import { expect, type Page, test } from "@playwright/test";
import {
  heading,
  oracleReadings,
  originOf,
  powerFlow,
  retireDevice,
  signIn,
  startSimulator,
  twoDevices,
} from "./support/core";

const DEVICE = "West roof";

/** One device's DC input and the plant's, in the power flow's own formatting. */
const usa = (n: number) => n.toLocaleString("en-US");
const dcTotal = oracleReadings()["dc.total_power"]!;
const ONE = usa(dcTotal);
const BOTH = usa(dcTotal * 2);

let sims: { child: ChildProcess; port: number }[] = [];
test.beforeAll(async () => {
  sims = [await startSimulator(), await startSimulator()];
});

test.afterAll(async ({ browser }, testInfo) => {
  sims.forEach((s) => s.child.kill());
  const context = await browser.newContext({ baseURL: testInfo.project.use.baseURL });
  const page = await context.newPage();
  await signIn(page);
  try {
    await page.request.put("/api/settings/kiosk", {
      data: { enabled: false },
      headers: originOf(page),
    });
    await retireDevice(page, DEVICE);
  } finally {
    await context.close();
  }
});

/** The `source` of every history read the page makes, in order. */
function historySources(page: Page): string[] {
  const seen: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/history/")) seen.push(url.searchParams.get("source") ?? "");
  });
  return seen;
}

/** One `/api/history/recent` answer: the source and width asked for, and the highest DC input in it. */
type Recent = { source: string; seconds: number; peak: number };

/** Every sparkline backfill the page reads, with what the core answered. */
function recentReads(page: Page): Recent[] {
  const seen: Recent[] = [];
  page.on("response", async (response) => {
    const url = new URL(response.url());
    if (url.pathname !== "/api/history/recent") return;
    const body = (await response.json()) as { metrics: Record<string, { v: number[] }> };
    seen.push({
      source: url.searchParams.get("source") ?? "",
      seconds: Number(url.searchParams.get("seconds")),
      peak: Math.max(...(body.metrics["dc.total_power"]?.v ?? [])),
    });
  });
  return seen;
}

const menuButton = (page: Page) => page.locator("[data-source-switcher]");

async function openMenu(page: Page) {
  await page.getByRole("button", { name: "Toggle Sidebar" }).first().click();
  await expect(menuButton(page)).toHaveCSS("display", "flex");
  await menuButton(page).click();
}

/** The menu closes first, the sidebar sheet behind it on the next press. */
async function closeSidebar(page: Page) {
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(menuButton(page)).toHaveCount(0);
}

async function choose(page: Page, name: string) {
  await openMenu(page);
  await page.getByRole("menuitemradio", { name }).click();
  await closeSidebar(page);
}

test.describe.configure({ mode: "serial" });

test("the menu switches the dashboard between the plant and a device, and a saved device survives a reload", async ({
  page,
}) => {
  await signIn(page);
  const slug = await twoDevices(page, sims, DEVICE);
  const sources = historySources(page);
  const recents = recentReads(page);
  await page.goto("/#/");
  await expect(heading(page)).toHaveText("Overview");

  // ── 1. Two devices in service: the plant is the default, its figures summed ──
  await expect(powerFlow(page)).toContainText(BOTH, { timeout: 30_000 });
  await openMenu(page);
  await expect(page.getByRole("menuitemradio")).toHaveText(["Plant", "SG01HP3", DEVICE]);
  await expect(page.getByRole("menuitemradio", { checked: true })).toHaveText(["Plant"]);
  await closeSidebar(page);
  expect(sources.length).toBeGreaterThan(0);
  expect(new Set(sources)).toEqual(new Set(["plant"]));

  // ── 2. One device: the tile is its own, and the reads name it ────────────
  sources.length = 0;
  await choose(page, DEVICE);
  await expect(powerFlow(page)).toContainText(ONE, { timeout: 30_000 });
  await expect(powerFlow(page)).not.toContainText(BOTH);
  await expect.poll(() => sources.includes(slug)).toBe(true);
  expect(sources).not.toContain("plant");
  // The sparklines restart from the device's own whole window: nothing of the plant's line is kept,
  // and the device's figures are not summed.
  await expect
    .poll(() => recents.find((r) => r.source === slug))
    .toEqual({ source: slug, seconds: 300, peak: dcTotal });

  // ── 3. The choice is saved: after a reload the device is still the source ──
  sources.length = 0;
  await page.reload();
  await expect(powerFlow(page)).toContainText(ONE, { timeout: 30_000 });
  await expect(powerFlow(page)).not.toContainText(BOTH);
  await openMenu(page);
  await expect(page.getByRole("menuitemradio", { checked: true })).toHaveText([DEVICE]);
  await closeSidebar(page);
  expect(new Set(sources)).toEqual(new Set([slug]));

  // ── 4. Back to the plant ─────────────────────────────────────────────────
  await choose(page, "Plant");
  await expect(powerFlow(page)).toContainText(BOTH, { timeout: 30_000 });
});

test("the kiosk view's default dashboard shows the plant, not dashes, and a visitor may pick a device", async ({
  page,
  browser,
}) => {
  await signIn(page);
  await page.goto("/#/settings/access");
  const toggle = page.getByRole("switch", { name: "Kiosk view" });
  await toggle.click();
  await expect(toggle).toBeChecked();

  const context = await browser.newContext();
  const visitor = await context.newPage();
  const sources = historySources(visitor);
  await visitor.goto("/#/");
  await expect(heading(visitor)).toHaveText("Overview");
  await expect(powerFlow(visitor)).toContainText(BOTH, { timeout: 30_000 });
  expect(new Set(sources)).toEqual(new Set(["plant"]));

  await choose(visitor, DEVICE);
  await expect(powerFlow(visitor)).toContainText(ONE, { timeout: 30_000 });
  await expect(powerFlow(visitor)).not.toContainText(BOTH);
  await context.close();
});
