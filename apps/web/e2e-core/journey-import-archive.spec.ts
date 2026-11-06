/**
 * JOURNEY, against the real core binary: a fresh core's admin imports the oracle's `current-2.x` archive,
 * which turns 3.x automation on. The guard stops it with the saved register value; Cancel leaves the store
 * empty; uploading again and confirming that automation was switched off imports it, and the result, the
 * device roster and the history the core now answers are the archive's.
 *
 * Runs on a core and web server of its own (`import` project): an import needs a core with no device, and
 * the onboarding journey's core has one. Golden values are read from the fixture's own files. The archive
 * is the fixture with one edit, its connection address: the imported device is polled at once, and the
 * fixture's address is not this machine's to dial, so the copy points at a closed loopback port.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { ADMIN, heading } from "./support/core";

const FIXTURE = join(import.meta.dirname, "../../../fixtures/oracle/archives/current-2.x");

const fixtureJson = (name: string) => JSON.parse(readFileSync(join(FIXTURE, name), "utf8"));

/** The fixture's members, re-packed with the device's connection moved to a closed loopback port. */
function archiveFile(): string {
  const dir = mkdtempSync(join(tmpdir(), "sunreye-e2e-archive-"));
  execFileSync("tar", ["-xzf", join(FIXTURE, "archive.tar.gz"), "-C", dir]);
  const config = fixtureJson("config.json");
  config.plant.connections[0].params.host = "127.0.0.1";
  config.plant.connections[0].params.port = 1;
  writeFileSync(join(dir, "config.json"), JSON.stringify(config));
  const file = join(dir, "archive.tar.gz");
  execFileSync("tar", [
    "-czf",
    file,
    "-C",
    dir,
    "manifest.json",
    "config.json",
    "config-log.ndjson.gz",
    "readings.ndjson.gz",
  ]);
  return file;
}

const expected = fixtureJson("expected-import.json").result as {
  inserted: Record<string, number>;
  replays: { gaps: { start: string; end: string }[] }[];
};
const held = Object.entries(
  fixtureJson("config.json").appSettings.find((s: { key: string }) => s.key === "automationState")
    .value as Record<string, { previousValue: number; capturedAt: string }>,
);

const picker = (page: Page) => page.getByLabel("Archive (.tar.gz)");
const dialog = (page: Page) => page.getByRole("dialog");
const devices = async (page: Page) =>
  ((await (await page.request.get("/api/devices")).json()) as { devices: unknown[] }).devices;

test("the admin imports an archive: the guard shows the held value, Cancel imports nothing, confirming does", async ({
  page,
}) => {
  const archive = archiveFile();

  // ── 1. A fresh core: the admin signs up and finds the import beside the wizard ──
  await page.goto("/#/");
  await expect(page).toHaveURL(/#\/onboarding$/);
  await page.getByLabel("Name").fill(ADMIN.name);
  await page.getByLabel("Email").fill(ADMIN.email);
  await page.getByLabel("Password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/#\/setup$/);
  await page.getByRole("link", { name: "Import a 3.x archive instead" }).click();
  await expect(heading(page)).toHaveText("Import a 3.x archive");

  // ── 2. The guard stops it with the saved values; Cancel after a tick imports nothing and the next guard starts unticked ──
  await picker(page).setInputFiles(archive);
  await expect(dialog(page)).toBeVisible();
  for (const [key, saved] of held) {
    const row = dialog(page).getByRole("row").filter({ hasText: key });
    await expect(row).toContainText(String(saved.previousValue));
    await expect(row).toContainText(saved.capturedAt);
  }
  await expect(dialog(page).getByRole("button", { name: "Continue" })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toBeVisible();
  await dialog(page).getByRole("checkbox").click();
  await expect(dialog(page).getByRole("button", { name: "Continue" })).toBeEnabled();
  await dialog(page).getByRole("button", { name: "Cancel" }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Import finished" })).toHaveCount(0);
  expect(await devices(page)).toEqual([]);

  // ── 3. The same archive again: unticked again, confirmed, it imports ─────────────────────
  await picker(page).setInputFiles(archive);
  await expect(dialog(page).getByRole("checkbox")).not.toBeChecked();
  await expect(dialog(page).getByRole("button", { name: "Continue" })).toBeDisabled();
  await dialog(page).getByRole("checkbox").click();
  await dialog(page).getByRole("button", { name: "Continue" }).click();
  const result = page.getByRole("region", { name: "Import finished" });
  await expect(result).toBeVisible();
  const rows = (label: string) => result.getByText(label, { exact: true }).locator("xpath=..");
  const read = expected.inserted;
  await expect(rows("Raw readings")).toContainText(String(read.raw));
  await expect(rows("Minute buckets")).toContainText(String(read.minute));
  await expect(rows("Hourly buckets")).toContainText(String(read.hourly));
  await expect(rows("Daily buckets")).toContainText(String(read.daily));
  await expect(rows("Configuration log lines")).toContainText(String(read.configLog));
  const [gap] = expected.replays[0]!.gaps;
  await expect(result).toContainText("Partial days not imported");
  await expect(result).toContainText(`${gap!.start} to ${gap!.end}`);
  expect(await devices(page)).toHaveLength(1);

  // ── 4. The history is the archive's, and the app opens on the imported plant ──
  const daily = readFileSync(join(FIXTURE, "readings.ndjson"), "utf8")
    .trim()
    .split("\n")
    .map(
      (line) =>
        JSON.parse(line) as {
          time: string;
          metric_key: string;
          value: number;
          source_tier: string;
        },
    )
    .filter((r) => r.source_tier === "daily" && r.metric_key === "oracle.archive.power");
  const days = await page.request.get(
    `/api/history/rollup?metric=oracle.archive.power&source=plant&bucket=day&from=${daily[0]!.time}&to=${daily.at(-1)!.time.replace("T00", "T01")}`,
  );
  expect(days.status()).toBe(200);
  const points = (await days.json()) as { avg?: number }[];
  expect(points.map((p) => p.avg)).toEqual(daily.map((r) => r.value));

  await result.getByRole("button", { name: "Continue" }).click();
  await expect(heading(page)).toHaveText("Overview");
  await page.goto("/#/statistics");
  await expect(heading(page)).toHaveText("Statistics");
  await page.goto("/#/settings/devices");
  await expect(page.locator("[data-device]")).toHaveCount(1);
});
