import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import * as m from "$lib/paraglide/messages";

vi.mock("$env/dynamic/public", () => ({ env: {} }));
const get = vi.fn();
const del = vi.fn();
vi.mock("$lib/core-api", () => ({ core: { GET: get, DELETE: del } }));
const toast = { success: vi.fn(), error: vi.fn() };
vi.mock("svelte-sonner", () => ({ toast }));

const { default: ProfilesForm } = await import("./profiles-form.svelte");

const ACME = {
  id: "acme-imported",
  name: "Acme Imported",
  manufacturer: "Acme",
  active: false,
  installed: true,
  builtin: false,
};
let listed: unknown[] = [];

beforeEach(() => {
  listed = [ACME];
  get.mockImplementation(async (path: string) => ({
    data: path === "/api/profiles" ? listed : [],
  }));
});
afterEach(() => {
  for (const fn of [get, del, toast.success, toast.error]) fn.mockReset();
});

async function confirmRemove() {
  await page.getByRole("button", { name: m.profiles_remove_aria({ name: ACME.name }) }).click();
  await page.getByRole("dialog").getByRole("button", { name: m.action_remove() }).click();
}

test("a confirmed removal deletes the profile by id, reports it and refreshes the list", async () => {
  del.mockImplementation(async () => {
    listed = [];
    return { response: { status: 204 } };
  });
  render(ProfilesForm, {});
  await confirmRemove();
  await vi.waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith(m.profiles_toast_uninstalled({ name: ACME.name })),
  );
  expect(del).toHaveBeenCalledWith("/api/settings/profiles/{id}", {
    params: { path: { id: ACME.id } },
  });
  await expect
    .element(page.getByRole("button", { name: m.profiles_remove_aria({ name: ACME.name }) }))
    .not.toBeInTheDocument();
});

test("a refused removal toasts the core's reason and keeps the profile", async () => {
  del.mockResolvedValue({ error: { error: "the active profile cannot be removed" } });
  render(ProfilesForm, {});
  await confirmRemove();
  await vi.waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      m.profiles_toast_uninstall_failed({ error: "the active profile cannot be removed" }),
    ),
  );
  expect(toast.success).not.toHaveBeenCalled();
  await expect
    .element(page.getByRole("button", { name: m.profiles_remove_aria({ name: ACME.name }) }))
    .toBeVisible();
});
