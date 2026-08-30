import { afterAll, describe, expect, mock, test } from "bun:test";
import { Elysia, t } from "elysia";

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
  .get("/read", { requireSession: true }, () => "ok")
  .get("/config", { requireAdmin: true }, () => "ok")
  // A gated route that also declares a body schema — the shape every write in
  // this app has. The schema is what makes the ordering below observable.
  .post(
    "/write",
    { requireAdmin: true, body: t.Object({ key: t.String() }) },
    ({ body }) => body.key,
  );

const status = (path: string) =>
  app.handle(new Request(`http://localhost${path}`)).then((r) => r.status);

const postStatus = (path: string, body: unknown) =>
  app
    .handle(
      new Request(`http://localhost${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    )
    .then((r) => r.status);

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

describe("the gate against a route that also declares a body schema", () => {
  // Elysia 2 validates the declared body BEFORE `beforeHandle`, so the schema
  // check wins the race against the guard. These tests pin that ordering
  // deliberately rather than wishing it away: it is the reason the route-smoke
  // harness accepts a 422 from an anonymous WRITE probe, and if a future Elysia
  // reorders the lifecycle this file goes red instead of the change passing
  // unnoticed. `../routes/admin-guard.ts` records what was tried.
  test("a malformed body from a stranger is answered by the SCHEMA, before the gate", async () => {
    publicDashboard = false;
    session = null;
    expect(await postStatus("/write", { wrong: 1 })).toBe(422);
  });

  // The part that actually matters, and the one a leak would break: a request
  // the route would otherwise ACT on is refused. Nothing privileged runs.
  test("a well-formed body from a stranger is refused — the handler never runs", async () => {
    publicDashboard = false;
    session = null;
    expect(await postStatus("/write", { key: "ok" })).toBe(401);
  });

  test("a well-formed body from a non-admin session is refused too", async () => {
    publicDashboard = true; // irrelevant to an admin gate, and pinned as such
    session = { user: { role: "user" } };
    expect(await postStatus("/write", { key: "ok" })).toBe(403);
  });

  test("an admin with a valid body reaches the handler", async () => {
    session = { user: { role: "admin" } };
    expect(await postStatus("/write", { key: "ok" })).toBe(200);
  });

  test("an admin with a malformed body still gets the validation error", async () => {
    session = { user: { role: "admin" } };
    expect(await postStatus("/write", { wrong: 1 })).toBe(422);
  });
});
