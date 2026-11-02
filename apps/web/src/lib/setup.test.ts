import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

// mock-hygiene-ignore-next-line -- SvelteKit virtual modules: no real module exists under bun test. The server-side values keep `core-api` loadable.
mock.module("$app/environment", () => ({ browser: false }));
// mock-hygiene-ignore-next-line -- SvelteKit virtual module, see above.
mock.module("$env/dynamic/public", () => ({ env: {} }));

const realCore = await import("$lib/core-api");
const realCoreExports = { ...realCore };

type Answer = { data?: { needsSetup?: boolean; needsProfile?: boolean } };
const answers: Record<string, Answer> = {};
const asked: string[] = [];
mock.module("$lib/core-api", () => ({
  ...realCore,
  core: {
    GET: async (path: string) => {
      asked.push(path);
      return answers[path] ?? {};
    },
  },
}));

afterAll(() => {
  mock.module("$lib/core-api", () => ({ ...realCoreExports }));
});

const { firstRunGate, needsSetup } = await import("./setup");

beforeEach(() => {
  for (const key of Object.keys(answers)) delete answers[key];
  asked.length = 0;
});

describe("needsSetup", () => {
  test("is what the server says", async () => {
    answers["/api/setup-status"] = { data: { needsSetup: true } };
    expect(await needsSetup()).toBe(true);
    answers["/api/setup-status"] = { data: { needsSetup: false } };
    expect(await needsSetup()).toBe(false);
  });

  test("no answer means no setup: an unreachable server must not bounce users to onboarding", async () => {
    expect(await needsSetup()).toBe(false);
  });
});

describe("firstRunGate", () => {
  test("no admin yet: create the account, and do not even ask about the profile", async () => {
    answers["/api/setup-status"] = { data: { needsSetup: true } };
    answers["/api/profile-status"] = { data: { needsProfile: true } };
    expect(await firstRunGate()).toBe("setup-account");
    expect(asked).toEqual(["/api/setup-status"]);
  });

  test("an admin but no profile: pick the profile", async () => {
    answers["/api/setup-status"] = { data: { needsSetup: false } };
    answers["/api/profile-status"] = { data: { needsProfile: true } };
    expect(await firstRunGate()).toBe("setup-profile");
  });

  test("configured: ready", async () => {
    answers["/api/setup-status"] = { data: { needsSetup: false } };
    answers["/api/profile-status"] = { data: { needsProfile: false } };
    expect(await firstRunGate()).toBe("ready");
  });

  test("unanswered status calls read as ready", async () => {
    expect(await firstRunGate()).toBe("ready");
  });
});
