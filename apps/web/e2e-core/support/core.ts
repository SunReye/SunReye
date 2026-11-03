/**
 * What the e2e-core journeys share: the simulator, the oracle values it replays and the admin the
 * onboarding journey creates.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";

const ROOT = join(import.meta.dirname, "../../../..");
const FIXTURES = join(ROOT, "fixtures/oracle");
const TARGET = process.env.CARGO_TARGET_DIR ?? join(ROOT, "target");
export const PROFILE = "deye-sg01hp3";
const CASE = "ramp";

export const ADMIN = {
  name: "Ada Lovelace",
  email: "ada@example.com",
  password: "analytical-engine",
};

/** What the 2.x engine decoded from the case's registers: the metric key → value the dashboard must show. */
export function oracleReadings(): Record<string, number> {
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
export async function startSimulator(): Promise<{ child: ChildProcess; port: number }> {
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

export const heading = (page: Page) => page.getByRole("heading", { level: 1 });

export const powerFlow = (page: Page) =>
  page
    .locator("section")
    .filter({ has: page.getByRole("heading", { level: 2, name: "Power flow", exact: true }) });
