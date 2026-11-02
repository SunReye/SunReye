import { afterEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { readable } from "svelte/store";
import * as m from "$lib/paraglide/messages";

vi.mock("$env/dynamic/public", () => ({ env: {} }));
const kioskEnabled = vi.fn();
const setKiosk = vi.fn();
vi.mock("$lib/kiosk", () => ({ kioskEnabled, setKiosk }));
const admin = { id: 1, name: "Ada", email: "ada@example.com", admin: true };
const signedIn = { user: admin };
vi.mock("$lib/session", () => ({
  useAppSession: () => readable({ data: signedIn, isPending: false }),
}));
const toast = { success: vi.fn(), error: vi.fn() };
vi.mock("svelte-sonner", () => ({ toast }));

const { default: AccessForm } = await import("./access-form.svelte");

afterEach(() => {
  signedIn.user = admin;
  for (const fn of [kioskEnabled, setKiosk, toast.success, toast.error]) fn.mockReset();
});

const toggle = () => page.getByRole("switch", { name: m.access_public_label() });

test("shows the core's kiosk switch", async () => {
  kioskEnabled.mockResolvedValue(true);
  render(AccessForm);
  await expect.element(toggle()).toBeChecked();
});

test("switching it on asks the core and confirms", async () => {
  kioskEnabled.mockResolvedValue(false);
  setKiosk.mockResolvedValue(true);
  render(AccessForm);
  await expect.element(toggle()).not.toBeChecked();
  await toggle().click();
  await expect.element(toggle()).toBeChecked();
  expect(setKiosk).toHaveBeenCalledWith(true);
  expect(toast.success).toHaveBeenCalledWith(m.access_toast_enabled());
});

test("a refused switch flips back and says so", async () => {
  kioskEnabled.mockResolvedValue(true);
  setKiosk.mockResolvedValue(false);
  render(AccessForm);
  await expect.element(toggle()).toBeChecked();
  await toggle().click();
  expect(setKiosk).toHaveBeenCalledWith(false);
  await expect.element(toggle()).toBeChecked();
  expect(toast.error).toHaveBeenCalledWith(m.access_toast_error());
});

test("a signed-in user who is not an admin cannot switch it", async () => {
  signedIn.user = { ...admin, admin: false };
  kioskEnabled.mockResolvedValue(false);
  render(AccessForm);
  await expect.element(toggle()).toBeDisabled();
  await expect.element(page.getByText(m.settings_admin_only())).toBeVisible();
  await toggle().click({ force: true });
  expect(setKiosk).not.toHaveBeenCalled();
});
