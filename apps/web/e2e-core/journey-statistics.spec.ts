/**
 * JOURNEY, against the real core binary: with two devices in service the statistics page reads the
 * plant's energy and, once the menu switches to one device, that device's, both cut in the plant's time
 * zone; the sections that need prices and costs, which the core does not serve, are not offered.
 *
 * The simulators replay fixed registers, so every counter stands still and every rise is zero: the
 * figures the tiles show are zeros, and the claims are the reads (source, zone, bucket, status), the
 * zero-filled periods and the sections shown. The recorded oracle cases hold the non-zero values
 * (`crates/sunreye/tests/statistics_oracle.rs`). The plant zone is moved to one far from UTC and put
 * back, and the added device is retired, in `afterAll`, so later journeys read what earlier ones left.
 */

import type { ChildProcess } from "node:child_process";
import { expect, type Page, test } from "@playwright/test";
import {
  heading,
  originOf,
  retireDevice,
  signIn,
  startSimulator,
  twoDevices,
} from "./support/core";

const DEVICE = "East roof";
const ZONE = "Pacific/Auckland";

let sims: { child: ChildProcess; port: number }[] = [];
let zoneBefore = "";
test.beforeAll(async () => {
  sims = [await startSimulator(), await startSimulator()];
});

test.afterAll(async ({ browser }, testInfo) => {
  sims.forEach((s) => s.child.kill());
  const context = await browser.newContext({ baseURL: testInfo.project.use.baseURL });
  const page = await context.newPage();
  await signIn(page);
  try {
    if (zoneBefore) {
      await page.request.put("/api/settings/time-zone", {
        data: { timeZone: zoneBefore },
        headers: originOf(page),
      });
    }
    await retireDevice(page, DEVICE);
  } finally {
    await context.close();
  }
});

/** One `/api/energy/series` read the page made and what the core answered. */
type Read = { source: string; bucket: string; status: number; keys: string[] };

function energyReads(page: Page): Read[] {
  const seen: Read[] = [];
  page.on("response", async (response) => {
    const url = new URL(response.url());
    if (url.pathname !== "/api/energy/series") return;
    const periods = response.ok() ? ((await response.json()) as { bucket: string }[]) : [];
    seen.push({
      source: url.searchParams.get("source") ?? "",
      bucket: url.searchParams.get("bucket") ?? "",
      status: response.status(),
      keys: periods.map((p) => p.bucket),
    });
  });
  return seen;
}

const section = (page: Page, title: string) =>
  page.locator("section").filter({
    has: page.getByRole("heading", { level: 2, name: title, exact: true }),
  });

const tile = (page: Page, label: string) =>
  section(page, "Energy").locator('[data-slot="stat-tile"]').filter({ hasText: label });

async function chooseSource(page: Page, name: string) {
  await page.getByRole("button", { name: "Toggle Sidebar" }).first().click();
  await page.locator("[data-source-switcher]").click();
  await page.getByRole("menuitemradio", { name }).click();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
}

test("the statistics page shows the energy of the plant and of one device in the plant's zone", async ({
  page,
}) => {
  await signIn(page);
  const slug = await twoDevices(page, sims, DEVICE);
  zoneBefore = (await (await page.request.get("/api/settings/time-zone")).json()).timeZone;
  const moved = await page.request.put("/api/settings/time-zone", {
    data: { timeZone: ZONE },
    headers: originOf(page),
  });
  expect(moved.status()).toBe(200);
  const reads = energyReads(page);

  // ── 1. The plant: the energy section only, its figures read as one plant ──
  await page.goto("/#/statistics");
  await expect(heading(page)).toHaveText("Statistics");
  await expect(section(page, "Energy")).toBeVisible();
  for (const label of ["Produced", "Grid import"]) await expect(tile(page, label)).toBeVisible();
  await expect(tile(page, "Produced")).toContainText(/\b0(\.0+)?\s*kWh/);
  // Costs, prices, records and amortisation need a tariff the core has none of.
  for (const title of ["Costs & savings", "Spot prices", "Records", "Amortisation"]) {
    await expect(section(page, title)).toHaveCount(0);
  }
  await expect.poll(() => reads.some((r) => r.source === "plant")).toBe(true);
  expect(new Set(reads.map((r) => r.status))).toEqual(new Set([200]));

  // ── 2. The days of the plant's zone: today's key is Auckland's date, not UTC's ──
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: ZONE }).format(new Date());
  const days = reads.find((r) => r.bucket === "day");
  expect(days?.keys).toContain(today);

  // ── 3. One device: the same section, read under the device's own source ──
  reads.length = 0;
  await chooseSource(page, DEVICE);
  await expect.poll(() => reads.some((r) => r.source === slug)).toBe(true);
  expect(reads.map((r) => r.source)).not.toContain("plant");
  expect(new Set(reads.map((r) => r.status))).toEqual(new Set([200]));
  await expect(tile(page, "Produced")).toBeVisible();
  await expect(tile(page, "Produced")).toContainText(/\b0(\.0+)?\s*kWh/);
});
