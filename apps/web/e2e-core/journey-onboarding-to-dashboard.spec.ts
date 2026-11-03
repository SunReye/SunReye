/**
 * JOURNEY, against the real core binary and the simulator: the first visitor creates the admin, onboards
 * a device, and the dashboard shows what the device answers; then the history charts show the minute,
 * hourly and daily tiers of what it has been answering.
 *
 * The values are the oracle fixture's, read from the file the simulator replays, so the expectation
 * and the simulator share a source but the dashboard's formatting stays the spec's independent claim.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";

const ROOT = join(import.meta.dirname, "../../..");
const FIXTURES = join(ROOT, "fixtures/oracle");
const TARGET = process.env.CARGO_TARGET_DIR ?? join(ROOT, "target");
const PROFILE = "deye-sg01hp3";
const CASE = "ramp";

/** What the 2.x engine decoded from the case's registers: the metric key → value the dashboard must show. */
function oracleReadings(): Record<string, number> {
  const rows = readFileSync(join(FIXTURES, "profile-decode.ndjson"), "utf8").trim().split("\n");
  for (const row of rows) {
    const { profile, cases } = JSON.parse(row) as {
      profile: { id: string };
      cases: { name: string; readings: Record<string, number> }[];
    };
    if (profile.id === PROFILE) return cases.find((c) => c.name === CASE)!.readings;
  }
  throw new Error(`no oracle profile ${PROFILE}`);
}

/** The simulator process and the address it listens on. */
async function startSimulator(): Promise<{ child: ChildProcess; port: number }> {
  const child = spawn(join(TARGET, "debug/sunreye-sim"), [FIXTURES, PROFILE, CASE], {
    stdio: ["ignore", "pipe", "inherit"],
  });
  const port = await new Promise<number>((resolve, reject) => {
    let seen = "";
    child.once("error", reject);
    child.once("exit", (code) =>
      reject(new Error(`sunreye-sim exited (${code}) before listening`)),
    );
    child.stdout!.on("data", (chunk: Buffer) => {
      seen += chunk.toString();
      const match = /listening 127\.0\.0\.1:(\d+)/.exec(seen);
      if (match) resolve(Number(match[1]));
    });
  });
  child.removeAllListeners("exit");
  return { child, port };
}

/** Pick one profile from the setup list, found through its name since the groups may be collapsed. */
async function selectProfile(page: Page, id: string): Promise<void> {
  const profiles = await page.request.get("/api/profiles");
  const { name } = ((await profiles.json()) as { id: string; name: string }[]).find(
    (p) => p.id === id,
  )!;
  await page.getByPlaceholder(/search/i).fill(name);
  const row = page
    .locator("div")
    .filter({ has: page.getByText(name, { exact: true }) })
    .filter({ has: page.getByRole("button", { name: "Select", exact: true }) })
    .last();
  await row.getByRole("button", { name: "Select", exact: true }).click();
}

const heading = (page: Page) => page.getByRole("heading", { level: 1 });

let simulator: { child: ChildProcess; port: number };

// The history journey continues the first one's core: its admin account and its polled readings.
test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  simulator = await startSimulator();
});
test.afterAll(() => {
  simulator.child.kill();
});

test("first-run admin, onboard a device, then live values on the dashboard", async ({ page }) => {
  // ── 1. A fresh core: any address ends on the sign-up form ────────────────
  await page.goto("/#/");
  await expect(page).toHaveURL(/#\/onboarding$/);
  await page.getByLabel("Name").fill("Ada Lovelace");
  await page.getByLabel("Email").fill("ada@example.com");
  await page.getByLabel("Password").fill("analytical-engine");
  await page.getByRole("button", { name: "Create account" }).click();

  // ── 2. The admin has no profile yet: setup, step 1 ───────────────────────
  await expect(page).toHaveURL(/#\/setup$/);
  await expect(heading(page)).toHaveText("Set up your inverter");
  await selectProfile(page, PROFILE);
  await page.getByRole("button", { name: "Continue" }).click();

  // ── 3. The connection is the simulator's address ─────────────────────────
  await page.getByLabel("Host").fill("127.0.0.1");
  await page.getByLabel("Port").fill(String(simulator.port));
  await page.getByLabel("Unit ID").fill("1");
  await page.getByLabel("Poll interval (ms)").fill("1000");
  await page.getByRole("button", { name: "Test connection" }).click();
  await expect(page.getByText(/^Connection OK/)).toBeVisible();
  // A successful test opens the captured snapshot over the form.
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Continue" }).click();

  // ── 4. Activate: the core polls at once, so the dashboard follows ────────
  await page.getByRole("button", { name: "Activate profile" }).click();
  await expect(page).toHaveURL(/#\/$/);
  await expect(heading(page)).toHaveText("Overview");

  // ── 5. Live values: the simulator's readings, arriving over /ws ──────────
  const want = oracleReadings();
  const usa = (n: number) => n.toLocaleString("en-US");
  const diagram = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { level: 2, name: "Power flow", exact: true }) });
  for (const shown of [
    usa(want["dc.pv1.power"]!),
    `${want["battery.soc"]}%`,
    usa(want["ac.total_power"]!),
    usa(want["ac.ups.total_power"]!),
  ]) {
    await expect(diagram).toContainText(shown, { timeout: 30_000 });
  }
});

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

type Row = { time: string; avg: number; min: number; max: number };
type Answer = { metric: string; rows: Row[] };

/** The first non-empty `bucket` answer the page gets for any metric: the cards on screen ask first. */
function rollupAnswer(page: Page, bucket: string): Promise<Answer> {
  return page
    .waitForResponse(
      async (response) => {
        const url = new URL(response.url());
        if (url.pathname !== "/api/history/rollup") return false;
        if (url.searchParams.get("bucket") !== bucket || !response.ok()) return false;
        return ((await response.json()) as Row[]).length > 0;
      },
      { timeout: 30_000 },
    )
    .then(async (response) => ({
      metric: new URL(response.url()).searchParams.get("metric") ?? "",
      rows: (await response.json()) as Row[],
    }));
}

test("history charts show the minute, hourly and daily tiers", async ({ page }) => {
  const readings = oracleReadings();
  const grains = page.getByRole("group", { name: "Select time span" });
  const chart = page.locator(".lc-root-container").first();

  /** Buckets sit on the tier's UTC grid and the constant simulator's reading is every bucket's. */
  const expectTier = ({ metric, rows }: Answer, width: number) => {
    expect(rows.every((r) => Date.parse(r.time) % width === 0)).toBe(true);
    expect(readings[metric], `oracle reading for ${metric}`).toBeDefined();
    expect(rows.at(-1)!.avg).toBe(readings[metric]);
  };

  // ── 1. Back in as the admin; a minute bucket is stored once its minute has closed ──
  const login = await page.request.post("/api/auth/login", {
    data: { email: "ada@example.com", password: "analytical-engine" },
  });
  expect(login.ok()).toBe(true);
  await expect
    .poll(
      async () => {
        const answer = await page.request.get(
          "/api/history/rollup?metric=battery.soc&bucket=minute&hours=1",
        );
        const body = await answer.text();
        if (!answer.ok()) throw new Error(`${answer.status()} ${body}`);
        return (JSON.parse(body) as Row[]).length;
      },
      { timeout: 100_000, intervals: [2_000] },
    )
    .toBeGreaterThan(0);

  // ── 2. Day: the minute tier ───────────────────────────────────────────────
  const minute = rollupAnswer(page, "minute");
  await page.goto("/#/history");
  await expect(heading(page)).toHaveText("History");
  expectTier(await minute, MINUTE_MS);
  await expect(chart).toBeVisible();

  // ── 3. Month: the hourly tier, the open hour included ─────────────────────
  const hour = rollupAnswer(page, "hour");
  await grains.getByRole("button", { name: "Month", exact: true }).click();
  expectTier(await hour, HOUR_MS);
  await expect(chart).toBeVisible();

  // ── 4. Year: the daily tier, today's open day included ────────────────────
  const day = rollupAnswer(page, "day");
  await grains.getByRole("button", { name: "Year", exact: true }).click();
  expectTier(await day, DAY_MS);
  await expect(chart).toBeVisible();
});
