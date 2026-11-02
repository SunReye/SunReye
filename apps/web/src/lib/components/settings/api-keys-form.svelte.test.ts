import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import type { components } from "$lib/core-api.gen";
import * as m from "$lib/paraglide/messages";

vi.mock("$env/dynamic/public", () => ({ env: {} }));
const get = vi.fn();
const post = vi.fn();
vi.mock("$lib/core-api", () => ({ core: { GET: get, POST: post } }));
const toast = { success: vi.fn(), error: vi.fn() };
vi.mock("svelte-sonner", () => ({ toast }));

const { default: ApiKeysForm } = await import("./api-keys-form.svelte");

type Account = components["schemas"]["Account"];
type KeyView = components["schemas"]["ApiKeyView"];
const ada: Account = { id: 7, name: "Ada Lovelace", email: "ada@example.com", admin: true };
const grafana: KeyView = {
  id: 3,
  name: "Grafana",
  start: "sunreye_ab",
  createdAt: "2026-10-01T08:00:00Z",
  userId: 7,
  userEmail: "ada@example.com",
  userName: "Ada Lovelace",
};

beforeEach(() => {
  get.mockImplementation(async (path: string) => ({
    data: path === "/api/admin/users" ? [ada] : [grafana],
  }));
});
afterEach(() => {
  for (const fn of [get, post, toast.success, toast.error]) fn.mockReset();
  vi.restoreAllMocks();
});

const row = (text: string) => page.getByRole("row").filter({ hasText: text });

async function issue(name: string) {
  await page.getByRole("button", { name: m.apikeys_select_user() }).click();
  await page.getByRole("option", { name: "ada@example.com" }).click();
  await page.getByLabelText(m.auth_field_name(), { exact: true }).fill(name);
  await page.getByRole("button", { name: m.apikeys_create() }).click();
}

test("lists the core's keys as their non-secret head", async () => {
  render(ApiKeysForm);
  await expect.element(row("Grafana")).toBeVisible();
  await expect.element(row("Grafana").getByText("sunreye_ab…")).toBeVisible();
  await expect.element(row("Grafana").getByText("ada@example.com")).toBeVisible();
  expect(get).toHaveBeenCalledWith("/api/admin/api-keys");
});

test("offers neither an expiry nor a per-user filter: the core has neither", async () => {
  render(ApiKeysForm);
  await expect.element(row("Grafana")).toBeVisible();
  await expect.element(page.getByText("Expires")).not.toBeInTheDocument();
  await expect.element(page.getByText("All users")).not.toBeInTheDocument();
});

test("issuing a key posts the owner and name, then shows the secret once", async () => {
  post.mockResolvedValue({
    data: { ...grafana, id: 4, name: "Backup", key: "sunreye_secretvalue" },
  });
  render(ApiKeysForm);
  await expect.element(row("Grafana")).toBeVisible();

  await issue("Backup");

  await vi.waitFor(() =>
    expect(post).toHaveBeenCalledWith("/api/admin/api-keys", {
      body: { userId: 7, name: "Backup" },
    }),
  );
  await expect.element(page.getByRole("dialog")).toBeVisible();
  expect((page.getByRole("dialog").getByRole("textbox").element() as HTMLInputElement).value).toBe(
    "sunreye_secretvalue",
  );
  expect(get).toHaveBeenCalledTimes(3);
});

test("issuing without an owner is refused before anything is sent", async () => {
  render(ApiKeysForm);
  await expect.element(row("Grafana")).toBeVisible();

  await page.getByLabelText(m.auth_field_name(), { exact: true }).fill("Orphan");
  await page.getByRole("button", { name: m.apikeys_create() }).click();

  expect(toast.error).toHaveBeenCalledWith(m.apikeys_toast_pick_user());
  expect(post).not.toHaveBeenCalled();
});

test("a refused key shows the core's reason", async () => {
  post.mockResolvedValue({ error: { error: "User not found" } });
  render(ApiKeysForm);
  await expect.element(row("Grafana")).toBeVisible();

  await issue("Backup");

  await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith("User not found"));
  await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
});

test("revoking asks first, then posts that key's id", async () => {
  post.mockResolvedValue({ response: { status: 204 } });
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  render(ApiKeysForm);

  await row("Grafana").getByRole("button", { name: m.apikeys_revoke_aria() }).click();

  expect(confirm).toHaveBeenCalledWith(m.apikeys_revoke_confirm({ label: "Grafana" }));
  await vi.waitFor(() =>
    expect(post).toHaveBeenCalledWith("/api/admin/api-keys/revoke", { body: { id: 3 } }),
  );
  await vi.waitFor(() => expect(toast.success).toHaveBeenCalledWith(m.apikeys_toast_revoked()));
});

test("declining the confirmation revokes nothing", async () => {
  vi.spyOn(window, "confirm").mockReturnValue(false);
  render(ApiKeysForm);

  await row("Grafana").getByRole("button", { name: m.apikeys_revoke_aria() }).click();

  expect(post).not.toHaveBeenCalled();
});
