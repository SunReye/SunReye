import { defineConfig, devices } from "@playwright/test";

/**
 * Browser test layer for the dashboard.
 *
 * This exists because the app is a rune shell and `bun test` cannot run one
 * (see `apps/web/TESTING.md`). Everything that only shows up when a real
 * document, a real scheduler and a real WebSocket are involved — a reactive
 * feedback loop that re-leases the socket twelve times a second, a scroll that
 * mounts sixty charts, a tween whose glide never settles — is invisible to the
 * unit suite, and used to be "covered" by asserting on the SOURCE TEXT of the
 * fix. A browser that counts requests sees the loop in one assertion.
 *
 * Deliberately NOT wired into `bun run test`: that stays a seconds-long unit
 * run. The specs live in `e2e/`, outside the source glob bun is pointed at
 * (`apps/<app>/src`), so `bun test` never tries to import `@playwright/test`,
 * which it cannot execute.
 *
 * The backend is entirely faked in-browser (`e2e/support/api-mock.ts`): no
 * Elysia server, no Postgres/TimescaleDB, no inverter. A run is
 * `bun run e2e` and nothing else.
 */
// The dev server port. Fixed by default so a developer's warm server is reused
// across runs; overridable so two worktrees can run the suite at once without
// fighting over one port. global-setup's identity probe still refuses a server
// that does not serve THIS checkout, whichever port it is on.
const PORT = Number(process.env.PW_PORT ?? 5199);
const ORIGIN = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  // Pre-bundle the module graph before anything is timed — a Vite dep-optimizer
  // full reload landing inside a measured sweep tears the probes down with the
  // document. See e2e/support/global-setup.ts.
  globalSetup: "./e2e/support/global-setup.ts",
  // Parallel, including WITHIN a file. That is the setting that matters: a spec
  // file never splits across workers, and one file here holds 27 tests, so
  // raising the worker count alone bought 22 % while `--fully-parallel` took the
  // biggest file from 104.7 s to 39.1 s.
  //
  // This layer used to run one worker, no sharding, because it measured frame
  // rates and mount cost and those numbers are only comparable when nothing else
  // is running. Those specs are gone (see git history for
  // `chart-mount-cost.spec.ts` and `overview-baseline.spec.ts`): what is left
  // asserts behaviour a contended machine cannot change — layout, request
  // counts, mount counts, socket lifecycle. Do NOT add a timing budget back
  // here without also giving it a serial home; under these settings it would
  // measure the runner's other workers.
  fullyParallel: true,
  // Locally: the machine. In CI: the runner has 4 cores and is also serving the
  // dev server, so oversubscribing costs more than it buys.
  workers: process.env.CI ? 4 : undefined,
  // Sharding splits the suite across independent jobs (`--shard=i/n`); CI fans
  // it out across a matrix. Nothing here holds cross-file state, so any split is
  // valid.
  timeout: 120_000,
  expect: { timeout: 15_000 },
  forbidOnly: !!process.env.CI,
  // One retry in CI only. Going parallel means the runner is oversubscribed —
  // four workers plus the dev server on a four-core box — and a layout assertion
  // was observed failing under that load and passing 8/8 in isolation. A retry
  // buys back the wall-clock win without turning contention into red builds.
  // It does mask genuine flakiness, so a spec that only ever passes on the retry
  // is a bug report, not a pass.
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  use: {
    baseURL: ORIGIN,
    // The tablet the dashboard is actually read on: a 2× display doing four
    // times the compositing work of the CI laptop, and touch scrolling.
    ...devices["Desktop Chrome"],
    viewport: { width: 1024, height: 768 },
    deviceScaleFactor: 2,
    hasTouch: true,
    trace: "retain-on-failure",
    video: "off",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium" }],
  webServer: {
    // `vite dev` straight, not `turbo run dev` — the turbo task depends on
    // `db:start`, which would boot Postgres in Docker for a suite that never
    // talks to it.
    command: `bunx vite dev --port ${PORT} --strictPort`,
    url: ORIGIN,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: "ignore",
    stderr: "pipe",
    env: {
      // Same-origin API base, so `page.route('**/api/**')` intercepts every
      // call (see src/lib/server-url.ts). An inherited PUBLIC_SERVER_URL from a
      // developer's .env would point the app at a real engine and the mocks
      // would never fire.
      PUBLIC_SERVER_URL: "",
      SKIP_ENV_VALIDATION: "1",
    },
  },
});
