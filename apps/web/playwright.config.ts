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
  // Perf numbers are the point of this layer, and parallel workers share the
  // machine's CPU. One worker, no sharding: a measured fps is only comparable
  // to the last one if nothing else was running.
  fullyParallel: false,
  workers: 1,
  // A scroll sweep is 12 s by design, plus the dev server's first compile.
  timeout: 120_000,
  expect: { timeout: 15_000 },
  forbidOnly: !!process.env.CI,
  retries: 0,
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
