import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

/**
 * Browser layer against the REAL core binary.
 *
 * `playwright.config.ts` fakes the whole backend in the page; this one boots `target/debug/sunreye` on a
 * scratch data directory and the Vite dev server in front of it (its proxy, `SUNREYE_CORE_PORT`), so a
 * journey crosses the SPA, the HTTP routes, the `/ws` feed and the store. The simulator is the spec's to
 * start: its port is the device's address. Build both first: `bun run e2e:core` does.
 *
 * Ports are fixed by default and overridable (`PW_CORE_PORT`, `PW_CORE_WEB_PORT`) so two slots can run
 * at once. A core already listening is never adopted: it would carry someone else's accounts.
 */
const CORE_PORT = Number(process.env.PW_CORE_PORT ?? 5299);
const WEB_PORT = Number(process.env.PW_CORE_WEB_PORT ?? 5198);
const ORIGIN = `http://127.0.0.1:${WEB_PORT}`;
const TARGET = process.env.CARGO_TARGET_DIR ?? join(import.meta.dirname, "../../target");
const DATA_DIR = join(tmpdir(), `sunreye-e2e-core-${CORE_PORT}`);

export default defineConfig({
  testDir: "./e2e-core",
  // One core, one set of accounts: specs share its state, so they run in order.
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: ORIGIN,
    ...devices["Desktop Chrome"],
    viewport: { width: 1280, height: 900 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium" }],
  webServer: [
    {
      // A fresh data directory per run: the first sign-up must find no admin.
      command: `rm -rf ${DATA_DIR} && mkdir -p ${DATA_DIR} && exec ${join(TARGET, "debug/sunreye")} --listen 127.0.0.1:${CORE_PORT} --data-dir ${DATA_DIR} --log-level warn`,
      url: `http://127.0.0.1:${CORE_PORT}/api/setup-status`,
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: "ignore",
      stderr: "pipe",
    },
    {
      command: `bunx vite dev --host 127.0.0.1 --port ${WEB_PORT} --strictPort`,
      url: ORIGIN,
      reuseExistingServer: false,
      timeout: 180_000,
      stdout: "ignore",
      stderr: "pipe",
      env: {
        // Same-origin API base: the dev server proxies it to the core.
        PUBLIC_SERVER_URL: "",
        SUNREYE_CORE_PORT: String(CORE_PORT),
        SKIP_ENV_VALIDATION: "1",
      },
    },
  ],
});
