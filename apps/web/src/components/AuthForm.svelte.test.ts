import { afterEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import type { components } from "$lib/core-api.gen";
import * as m from "$lib/paraglide/messages";

vi.mock("$env/dynamic/public", () => ({ env: {} }));
const post = vi.fn();
const del = vi.fn();
vi.mock("$lib/core-api", () => ({ core: { POST: post, GET: vi.fn(), DELETE: del } }));
const goto = vi.fn();
vi.mock("$app/navigation", () => ({ goto }));

const { default: AuthForm } = await import("./AuthForm.svelte");
const { useAppSession, signOut } = await import("$lib/session");
const { get } = await import("svelte/store");

type Account = components["schemas"]["Account"];
const ada: Account = { id: 1, name: "Ada Lovelace", email: "ada@example.com", admin: true };

afterEach(async () => {
  del.mockResolvedValue({ response: new Response(null, { status: 204 }) });
  await signOut();
  post.mockReset();
  goto.mockReset();
});

async function fill(label: string, value: string) {
  await page.getByLabelText(label, { exact: true }).fill(value);
}

test("first-run sign-up posts the account, then lands on the overview signed in", async () => {
  post.mockResolvedValue({ data: ada, response: { status: 200 } });
  render(AuthForm, { mode: "signup" });

  await fill(m.auth_field_name(), "Ada Lovelace");
  await fill(m.auth_field_email(), "ada@example.com");
  await fill(m.auth_field_password(), "analytical-engine");
  await page.getByRole("button", { name: m.auth_create_account() }).click();

  await vi.waitFor(() =>
    expect(goto).toHaveBeenCalledWith(`${location.pathname}${location.search}#/`),
  );
  expect(post).toHaveBeenCalledWith("/api/auth/sign-up", {
    body: { name: "Ada Lovelace", email: "ada@example.com", password: "analytical-engine" },
  });
  expect(get(useAppSession())).toEqual({ data: { user: ada }, isPending: false });
});

test("sign-in sends the remember-me choice and lands on the overview", async () => {
  post.mockResolvedValue({ data: ada, response: { status: 200 } });
  render(AuthForm, { mode: "signin" });

  await fill(m.auth_field_email(), "ada@example.com");
  await fill(m.auth_field_password(), "analytical-engine");
  await page.getByRole("checkbox").click();
  await page.getByRole("button", { name: m.login_title() }).click();

  await vi.waitFor(() => expect(goto).toHaveBeenCalledTimes(1));
  expect(post).toHaveBeenCalledWith("/api/auth/login", {
    body: { email: "ada@example.com", password: "analytical-engine", rememberMe: false },
  });
});

test("a wrong password shows the core's reason and stays on the form", async () => {
  post.mockResolvedValue({
    error: { error: "Wrong email or password" },
    response: { status: 401 },
  });
  render(AuthForm, { mode: "signin" });

  await fill(m.auth_field_email(), "ada@example.com");
  await fill(m.auth_field_password(), "nope");
  await page.getByRole("button", { name: m.login_title() }).click();

  await expect.element(page.getByRole("alert")).toHaveTextContent("Wrong email or password");
  expect(goto).not.toHaveBeenCalled();
  expect(get(useAppSession()).data).toBeNull();
  await expect.element(page.getByRole("button", { name: m.login_title() })).toBeEnabled();
});

test("a refused second sign-up shows the refusal", async () => {
  post.mockResolvedValue({ error: { error: "Sign-up is closed" }, response: { status: 403 } });
  render(AuthForm, { mode: "signup" });

  await fill(m.auth_field_name(), "Eve");
  await fill(m.auth_field_email(), "eve@example.com");
  await fill(m.auth_field_password(), "longenough");
  await page.getByRole("button", { name: m.auth_create_account() }).click();

  await expect.element(page.getByRole("alert")).toHaveTextContent("Sign-up is closed");
  expect(goto).not.toHaveBeenCalled();
});

test("a core that never answers falls back to the generic message", async () => {
  post.mockRejectedValue(new TypeError("Failed to fetch"));
  render(AuthForm, { mode: "signin" });

  await fill(m.auth_field_email(), "ada@example.com");
  await fill(m.auth_field_password(), "analytical-engine");
  await page.getByRole("button", { name: m.login_title() }).click();

  await expect.element(page.getByRole("alert")).toHaveTextContent(m.auth_error_generic());
});

test("a short password is refused before anything is sent", async () => {
  render(AuthForm, { mode: "signup" });

  await fill(m.auth_field_name(), "Ada Lovelace");
  await fill(m.auth_field_email(), "ada@example.com");
  await fill(m.auth_field_password(), "short");
  await page.getByRole("button", { name: m.auth_create_account() }).click();

  await expect.element(page.getByText(m.auth_password_min())).toBeVisible();
  expect(post).not.toHaveBeenCalled();
});

// The core counts characters for the minimum and UTF-8 bytes for the maximum (bcrypt reads 72).
test.each([
  ["four emoji (8 UTF-16 units)", "😀".repeat(4), () => m.auth_password_min()],
  ["73 bytes", "x".repeat(73), () => m.auth_password_max()],
  ["37 two-byte characters (74 bytes)", "é".repeat(37), () => m.auth_password_max()],
])("a password of %s is refused before anything is sent", async (_, password, message) => {
  render(AuthForm, { mode: "signup" });

  await fill(m.auth_field_name(), "Ada Lovelace");
  await fill(m.auth_field_email(), "ada@example.com");
  await fill(m.auth_field_password(), password);
  await page.getByRole("button", { name: m.auth_create_account() }).click();

  await expect.element(page.getByText(message())).toBeVisible();
  expect(post).not.toHaveBeenCalled();
});

test("a password of exactly 72 bytes is sent", async () => {
  post.mockResolvedValue({ data: ada, response: { status: 200 } });
  render(AuthForm, { mode: "signup" });

  await fill(m.auth_field_name(), "Ada Lovelace");
  await fill(m.auth_field_email(), "ada@example.com");
  await fill(m.auth_field_password(), "é".repeat(36));
  await page.getByRole("button", { name: m.auth_create_account() }).click();

  await vi.waitFor(() =>
    expect(post).toHaveBeenCalledWith("/api/auth/sign-up", {
      body: { name: "Ada Lovelace", email: "ada@example.com", password: "é".repeat(36) },
    }),
  );
});
