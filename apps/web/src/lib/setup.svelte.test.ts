import { afterEach, expect, test, vi } from "vitest";

vi.mock("$env/dynamic/public", () => ({ env: {} }));
const get = vi.fn();
vi.mock("$lib/core-api", () => ({ core: { GET: get } }));

const { firstRunGate, needsSetup } = await import("./setup");

afterEach(() => get.mockReset());

/** The two gate endpoints, answered the way the core answers them. */
function answers(setup: { needsSetup: boolean }, profile: { needsProfile: boolean }) {
  get.mockImplementation(async (path: string) => ({
    data: path === "/api/setup-status" ? setup : profile,
  }));
}

test("the account gate wins over the profile gate", async () => {
  answers({ needsSetup: true }, { needsProfile: true });
  expect(await firstRunGate()).toBe("setup-account");
});

test("an instance with an account but no profile goes to profile setup", async () => {
  answers({ needsSetup: false }, { needsProfile: true });
  expect(await firstRunGate()).toBe("setup-profile");
});

test("a configured instance is ready", async () => {
  answers({ needsSetup: false }, { needsProfile: false });
  expect(await firstRunGate()).toBe("ready");
  expect(get).toHaveBeenCalledWith("/api/setup-status");
  expect(get).toHaveBeenCalledWith("/api/profile-status");
});

test("a gate that did not answer is not a reason to hold the user back", async () => {
  get.mockResolvedValue({ data: undefined, error: "boom" });
  expect(await needsSetup()).toBe(false);
  expect(await firstRunGate()).toBe("ready");
});
