import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import type { components } from "$lib/core-api.gen";
import * as m from "$lib/paraglide/messages";

vi.mock("$env/dynamic/public", () => ({ env: {} }));
const get = vi.fn();
const post = vi.fn();
const put = vi.fn();
const del = vi.fn();
vi.mock("$lib/core-api", () => ({ core: { GET: get, POST: post, PUT: put, DELETE: del } }));
const toast = { success: vi.fn(), error: vi.fn() };
vi.mock("svelte-sonner", () => ({ toast }));

const { default: UsersForm } = await import("./users-form.svelte");

type Account = components["schemas"]["Account"];
const ada: Account = { id: 7, name: "Ada Lovelace", email: "ada@example.com", admin: true };
const bob: Account = { id: 9, name: "Bob Babbage", email: "bob@example.com", admin: false };

beforeEach(() => {
  get.mockResolvedValue({ data: [ada, bob] });
});
afterEach(() => {
  for (const fn of [get, post, put, del, toast.success, toast.error]) fn.mockReset();
  vi.restoreAllMocks();
});

const row = (email: string) => page.getByRole("row").filter({ hasText: email });

test("lists the core's accounts with their roles", async () => {
  render(UsersForm);
  await expect
    .element(
      row("ada@example.com").getByRole("button", { name: m.users_role_admin(), exact: true }),
    )
    .toBeVisible();
  await expect
    .element(row("bob@example.com").getByRole("button", { name: m.users_role_user(), exact: true }))
    .toBeVisible();
  expect(get).toHaveBeenCalledWith("/api/admin/users");
});

test("a list the core refuses is reported, not shown empty", async () => {
  get.mockResolvedValue({ error: { error: "Admin only" } });
  render(UsersForm);
  await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith(m.users_toast_load_error()));
});

test("adding a user posts the new account and reloads the list", async () => {
  post.mockResolvedValue({ data: bob });
  render(UsersForm);
  await expect.element(row("bob@example.com")).toBeVisible();

  await page.getByLabelText(m.auth_field_name(), { exact: true }).fill("Cy Turing");
  await page.getByLabelText(m.auth_field_email(), { exact: true }).fill("cy@example.com");
  await page.getByLabelText(m.auth_field_password(), { exact: true }).fill("enigma-machine");
  await page.getByRole("button", { name: m.action_add() }).click();

  await vi.waitFor(() =>
    expect(post).toHaveBeenCalledWith("/api/admin/users", {
      body: {
        name: "Cy Turing",
        email: "cy@example.com",
        password: "enigma-machine",
        admin: false,
      },
    }),
  );
  await vi.waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith(m.users_toast_created({ email: "cy@example.com" })),
  );
  expect(get).toHaveBeenCalledTimes(2);
});

test("adding an admin posts the admin flag", async () => {
  get.mockResolvedValue({ data: [ada] });
  post.mockResolvedValue({ data: bob });
  render(UsersForm);
  await expect.element(row("ada@example.com")).toBeVisible();

  await page.getByLabelText(m.auth_field_name(), { exact: true }).fill("Cy Turing");
  await page.getByLabelText(m.auth_field_email(), { exact: true }).fill("cy@example.com");
  await page.getByLabelText(m.auth_field_password(), { exact: true }).fill("enigma-machine");
  await page.getByRole("button", { name: m.users_role_user(), exact: true }).click();
  await page.getByRole("option", { name: m.users_role_admin() }).click();
  await page.getByRole("button", { name: m.action_add() }).click();

  await vi.waitFor(() =>
    expect(post).toHaveBeenCalledWith("/api/admin/users", {
      body: {
        name: "Cy Turing",
        email: "cy@example.com",
        password: "enigma-machine",
        admin: true,
      },
    }),
  );
});

test("a refused account shows the core's reason", async () => {
  post.mockResolvedValue({ error: { error: "Email already registered" } });
  render(UsersForm);
  await expect.element(row("bob@example.com")).toBeVisible();

  await page.getByLabelText(m.auth_field_name(), { exact: true }).fill("Bob Again");
  await page.getByLabelText(m.auth_field_email(), { exact: true }).fill("bob@example.com");
  await page.getByLabelText(m.auth_field_password(), { exact: true }).fill("analytical");
  await page.getByRole("button", { name: m.action_add() }).click();

  await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith("Email already registered"));
  expect(get).toHaveBeenCalledTimes(1);
});

test("promoting a user puts the admin flag on that account", async () => {
  put.mockResolvedValue({ data: { ...bob, admin: true } });
  render(UsersForm);

  await row("bob@example.com")
    .getByRole("button", { name: m.users_role_user(), exact: true })
    .click();
  await page.getByRole("option", { name: m.users_role_admin() }).click();

  await vi.waitFor(() =>
    expect(put).toHaveBeenCalledWith("/api/admin/users/{id}/role", {
      params: { path: { id: 9 } },
      body: { admin: true },
    }),
  );
  await vi.waitFor(() => expect(toast.success).toHaveBeenCalledWith(m.users_toast_role_updated()));
});

test("removing a user asks first, then deletes that account", async () => {
  del.mockResolvedValue({ response: { status: 204 } });
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  render(UsersForm);

  await row("bob@example.com").getByRole("button", { name: m.users_remove_aria() }).click();

  expect(confirm).toHaveBeenCalledWith(m.users_remove_confirm({ label: "bob@example.com" }));
  await vi.waitFor(() =>
    expect(del).toHaveBeenCalledWith("/api/admin/users/{id}", { params: { path: { id: 9 } } }),
  );
  await vi.waitFor(() => expect(toast.success).toHaveBeenCalledWith(m.users_toast_removed()));
});

test("declining the confirmation removes nothing", async () => {
  vi.spyOn(window, "confirm").mockReturnValue(false);
  render(UsersForm);

  await row("bob@example.com").getByRole("button", { name: m.users_remove_aria() }).click();

  expect(del).not.toHaveBeenCalled();
});

test("the last admin cannot be removed: the core's reason is shown", async () => {
  del.mockResolvedValue({ error: { error: "The last admin cannot be removed" } });
  vi.spyOn(window, "confirm").mockReturnValue(true);
  render(UsersForm);

  await row("ada@example.com").getByRole("button", { name: m.users_remove_aria() }).click();

  await vi.waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith("The last admin cannot be removed"),
  );
  expect(toast.success).not.toHaveBeenCalled();
});

// bcrypt reads 72 UTF-8 bytes; the core refuses more in English, so the form refuses first.
test.each([
  ["73 bytes", "x".repeat(73)],
  ["37 two-byte characters (74 bytes)", "é".repeat(37)],
])("a password of %s is refused before anything is sent", async (_, password) => {
  render(UsersForm);
  await expect.element(row("bob@example.com")).toBeVisible();

  await page.getByLabelText(m.auth_field_name(), { exact: true }).fill("Cy Turing");
  await page.getByLabelText(m.auth_field_email(), { exact: true }).fill("cy@example.com");
  await page.getByLabelText(m.auth_field_password(), { exact: true }).fill(password);
  await page.getByRole("button", { name: m.action_add() }).click();

  await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith(m.auth_password_max()));
  expect(post).not.toHaveBeenCalled();
});

test("a password of exactly 72 bytes is sent", async () => {
  post.mockResolvedValue({ data: bob });
  render(UsersForm);
  await expect.element(row("bob@example.com")).toBeVisible();

  await page.getByLabelText(m.auth_field_name(), { exact: true }).fill("Cy Turing");
  await page.getByLabelText(m.auth_field_email(), { exact: true }).fill("cy@example.com");
  await page.getByLabelText(m.auth_field_password(), { exact: true }).fill("é".repeat(36));
  await page.getByRole("button", { name: m.action_add() }).click();

  await vi.waitFor(() =>
    expect(post).toHaveBeenCalledWith("/api/admin/users", {
      body: { name: "Cy Turing", email: "cy@example.com", password: "é".repeat(36), admin: false },
    }),
  );
});
