import createClient from "openapi-fetch";
import { afterEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import type { components, paths } from "$lib/core-api.gen";
import * as m from "$lib/paraglide/messages";

vi.mock("$env/dynamic/public", () => ({ env: {} }));
const get = vi.fn();
const del = vi.fn();
vi.mock("$lib/core-api", () => ({ core: { GET: get, POST: vi.fn(), DELETE: del } }));
const goto = vi.fn();
vi.mock("$app/navigation", () => ({ goto }));
const toast = { error: vi.fn() };
vi.mock("svelte-sonner", () => ({ toast }));
vi.mock("$app/state", () => ({ page: { url: new URL("http://localhost/#/") } }));

const { default: Fixture } = await import("./app-sidebar.fixture.svelte");
const { refreshSession, signOut } = await import("$lib/session");
const { coreCapabilities } = await import("$lib/capabilities.svelte");

type Account = components["schemas"]["Account"];
const ada: Account = { id: 1, name: "Ada Lovelace", email: "ada@example.com", admin: true };
const bob: Account = { id: 2, name: "Bob Babbage", email: "bob@example.com", admin: false };

afterEach(async () => {
  del.mockImplementation(() => deleteAnswer(204));
  await signOut();
  get.mockRejectedValue(new Error("no core"));
  await coreCapabilities.load();
  for (const fn of [get, del, goto, toast.error]) fn.mockReset();
});

/** What `DELETE /api/auth/session` answers after the real openapi-fetch client has read a response. */
function deleteAnswer(status: number, body?: unknown) {
  return createClient<paths>({
    baseUrl: "http://core.test",
    fetch: async () =>
      new Response(body === undefined ? null : JSON.stringify(body), {
        status,
        headers: body === undefined ? undefined : { "content-type": "application/json" },
      }),
  }).DELETE("/api/auth/session");
}

/** Mount the sidebar for whoever the core says is signed in; `null` is a 401. */
async function mountAs(account: Account | null) {
  get.mockResolvedValue(account ? { data: account } : { error: { error: "Not signed in" } });
  await refreshSession();
  const view = render(Fixture);
  // The sidebar is a sheet on every viewport: closed until its trigger is pressed.
  await page.getByRole("button", { name: "Toggle Sidebar" }).click();
  return view;
}

test("an admin sees their name and the Settings entry", async () => {
  await mountAs(ada);
  await expect.element(page.getByText("Ada Lovelace")).toBeVisible();
  await expect.element(page.getByRole("link", { name: m.nav_settings() })).toBeVisible();
});

test("a plain user gets no Settings entry", async () => {
  await mountAs(bob);
  await expect.element(page.getByText("Bob Babbage")).toBeVisible();
  await expect.element(page.getByRole("link", { name: m.nav_settings() })).not.toBeInTheDocument();
});

test("signing out ends the session at the core and returns to login", async () => {
  del.mockImplementation(() => deleteAnswer(204));
  await mountAs(ada);

  await page.getByRole("button", { name: m.nav_sign_out() }).click();

  await vi.waitFor(() => expect(del).toHaveBeenCalledWith("/api/auth/session"));
  await vi.waitFor(() =>
    expect(goto).toHaveBeenCalledWith(`${location.pathname}${location.search}#/login`),
  );
  await expect.element(page.getByRole("link", { name: m.nav_log_in() })).toBeVisible();
  await expect.element(page.getByText("Ada Lovelace")).not.toBeInTheDocument();
});

test("a refused sign-out keeps the account, stays put and says why", async () => {
  del.mockImplementation(() => deleteAnswer(403, { error: "Origin not allowed" }));
  await mountAs(ada);

  await page.getByRole("button", { name: m.nav_sign_out() }).click();

  await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith("Origin not allowed"));
  expect(goto).not.toHaveBeenCalled();
  await expect.element(page.getByText("Ada Lovelace")).toBeVisible();
});

test("signing out of an expired session still signs out and returns to login", async () => {
  del.mockImplementation(() => deleteAnswer(401, { error: "Not signed in" }));
  await mountAs(ada);

  await page.getByRole("button", { name: m.nav_sign_out() }).click();

  await vi.waitFor(() =>
    expect(goto).toHaveBeenCalledWith(`${location.pathname}${location.search}#/login`),
  );
  expect(toast.error).not.toHaveBeenCalled();
  await expect.element(page.getByText("Ada Lovelace")).not.toBeInTheDocument();
});

test("a visitor with no session is offered the way in", async () => {
  await mountAs(null);
  await expect.element(page.getByRole("link", { name: m.nav_log_in() })).toBeVisible();
  await expect
    .element(page.getByRole("button", { name: m.nav_sign_out() }))
    .not.toBeInTheDocument();
});

/** What a core that serves nothing optional reports. */
const NOTHING = {
  history: false,
  statistics: false,
  controls: false,
  automations: false,
  restart: false,
  profileSources: false,
  integrations: false,
  pvAndBattery: false,
  pricesAndCosts: false,
  statisticsHeatmap: false,
  evccCommands: false,
  customCharts: false,
  logging: false,
  dataReset: false,
};

test("an admin is offered Automations when the core serves them, with no master switch to flip", async () => {
  get.mockResolvedValue({ data: { ...NOTHING, automations: true } });
  await coreCapabilities.load();
  await mountAs(ada);
  await expect.element(page.getByRole("link", { name: m.nav_automations() })).toBeVisible();
});

test("an admin is offered no Automations when the core does not serve them", async () => {
  get.mockResolvedValue({ data: NOTHING });
  await coreCapabilities.load();
  await mountAs(ada);
  await expect.element(page.getByRole("link", { name: m.nav_settings() })).toBeVisible();
  await expect
    .element(page.getByRole("link", { name: m.nav_automations() }))
    .not.toBeInTheDocument();
});
