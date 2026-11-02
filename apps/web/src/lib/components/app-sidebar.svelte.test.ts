import { afterEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import type { components } from "$lib/core-api.gen";
import * as m from "$lib/paraglide/messages";

vi.mock("$env/dynamic/public", () => ({ env: {} }));
const get = vi.fn();
const del = vi.fn();
vi.mock("$lib/core-api", () => ({ core: { GET: get, POST: vi.fn(), DELETE: del } }));
const goto = vi.fn();
vi.mock("$app/navigation", () => ({ goto }));
vi.mock("$app/state", () => ({ page: { url: new URL("http://localhost/#/") } }));
vi.mock("$lib/automations-gate.svelte", () => ({
  automationsGate: { load: vi.fn(), enabled: false },
}));

const { default: Fixture } = await import("./app-sidebar.fixture.svelte");
const { refreshSession, signOut } = await import("$lib/session");

type Account = components["schemas"]["Account"];
const ada: Account = { id: 1, name: "Ada Lovelace", email: "ada@example.com", admin: true };
const bob: Account = { id: 2, name: "Bob Babbage", email: "bob@example.com", admin: false };

afterEach(async () => {
  del.mockResolvedValue({ response: { status: 204 } });
  await signOut();
  for (const fn of [get, del, goto]) fn.mockReset();
});

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
  del.mockResolvedValue({ response: { status: 204 } });
  await mountAs(ada);

  await page.getByRole("button", { name: m.nav_sign_out() }).click();

  await vi.waitFor(() => expect(del).toHaveBeenCalledWith("/api/auth/session"));
  await vi.waitFor(() =>
    expect(goto).toHaveBeenCalledWith(`${location.pathname}${location.search}#/login`),
  );
  await expect.element(page.getByRole("link", { name: m.nav_log_in() })).toBeVisible();
  await expect.element(page.getByText("Ada Lovelace")).not.toBeInTheDocument();
});

test("a visitor with no session is offered the way in", async () => {
  await mountAs(null);
  await expect.element(page.getByRole("link", { name: m.nav_log_in() })).toBeVisible();
  await expect
    .element(page.getByRole("button", { name: m.nav_sign_out() }))
    .not.toBeInTheDocument();
});
