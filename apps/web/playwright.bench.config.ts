import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

/**
 * Measurements that are not gate checks: wall-clock and CPU-time dependent runs, one worker at a time
 * so nothing else competes for the host. `bun run bench:e2e` prints their numbers; a bench asserts
 * nothing. Same dev server, backend fake and port override (`PW_PORT`) as the gate.
 */
export default defineConfig({
  ...base,
  testDir: "./bench",
  testMatch: /.*\.bench\.ts/,
  fullyParallel: false,
  workers: 1,
  timeout: 300_000,
  reporter: [["list"]],
  retries: 0,
});
