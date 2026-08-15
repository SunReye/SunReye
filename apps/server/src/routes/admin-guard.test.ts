import { afterAll, describe, expect, mock, test } from "bun:test";
import { Elysia } from "elysia";

// Mutable stand-ins the mocked modules read at call time, so each test can set
// the public-dashboard flag and the current session independently.
let publicDashboard = false;
let session: { user: { role: string } } | null = null;

// Spread the real module: mock.module is process-global and permanent, so a
// factory returning only what this suite needs deletes the other exports for
// every test file that runs after it (see scripts/mock-hygiene.ts).
const realAccessSettings = await import("../settings/access-settings");

// The spread keeps the other exports alive; it does nothing about the stub,
// which is permanent and stayed installed for every later file. That is not
// theoretical here: this `isPublicDashboard` stub was observed failing two of
// `../settings/access-settings`'s own tests, which unit-test the real reader and
// were silently asserting against this double. Snapshot the exports BY VALUE
// now — a namespace is live, so once the mock below is installed the namespace's
// own `isPublicDashboard` IS the stub, and handing it back restores nothing.
const realAccessSettingsExports = { ...realAccessSettings };

mock.module("../settings/access-settings", () => ({
  ...realAccessSettings,
  isPublicDashboard: async () => publicDashboard,
}));
// mock-hygiene-ignore-next-line -- importing the real module boots Better Auth, which reads env and a database; avoiding that is the whole point of mocking it here. `auth` is its only export the server imports.
mock.module("@SunReye/auth", () => ({
  auth: { api: { getSession: async () => session } },
}));

// Import after the mocks are registered so the guard binds to them.
const { adminGuard } = await import("./admin-guard");

const app = new Elysia()
  .use(adminGuard)
  .get("/read", () => "ok", { requireSession: true })
  .get("/config", () => "ok", { requireAdmin: true });

const status = (path: string) =>
  app.handle(new Request(`http://localhost${path}`)).then((r) => r.status);

// `afterAll`, not `afterEach`: the guard above binds to the stub and every test
// in this file still needs it. `@SunReye/auth` is not handed back — the real
// module cannot be imported to snapshot (booting Better Auth is what the mock
// avoids), and no suite in this repo unit-tests it.
afterAll(() => {
  mock.module("../settings/access-settings", () => ({ ...realAccessSettingsExports }));
});

describe("requireSession (dashboard reads)", () => {
  test("401 when locked down and no session", async () => {
    publicDashboard = false;
    session = null;
    expect(await status("/read")).toBe(401);
  });

  test("200 anonymously when the public dashboard is enabled", async () => {
    publicDashboard = true;
    session = null;
    expect(await status("/read")).toBe(200);
  });

  test("200 with any session when locked down", async () => {
    publicDashboard = false;
    session = { user: { role: "user" } };
    expect(await status("/read")).toBe(200);
  });
});

describe("requireAdmin (config reads/writes) ignores the public flag", () => {
  test("401 without a session even when the public dashboard is on", async () => {
    publicDashboard = true;
    session = null;
    expect(await status("/config")).toBe(401);
  });

  test("403 for a non-admin session", async () => {
    publicDashboard = true;
    session = { user: { role: "user" } };
    expect(await status("/config")).toBe(403);
  });

  test("200 for an admin session", async () => {
    session = { user: { role: "admin" } };
    expect(await status("/config")).toBe(200);
  });
});
