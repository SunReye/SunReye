import { describe, expect, mock, test } from "bun:test";
import { Elysia } from "elysia";

// Mutable stand-ins the mocked modules read at call time, so each test can set
// the public-dashboard flag and the current session independently.
let publicDashboard = false;
let session: { user: { role: string } } | null = null;

mock.module("../settings/access-settings", () => ({
  isPublicDashboard: async () => publicDashboard,
}));
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
