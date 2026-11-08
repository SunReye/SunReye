import { beforeEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { readable } from "svelte/store";
import * as m from "$lib/paraglide/messages";

vi.mock("$env/dynamic/public", () => ({ env: {} }));
let admin = true;
vi.mock("$lib/session", () => ({
  useAppSession: () => readable({ data: { user: { admin } }, isPending: false }),
}));

const { default: InvestmentPrompt } = await import("./investment-prompt.svelte");

beforeEach(() => {
  admin = true;
});

test("an admin is sent to the tariff panel where the plant cost is entered", async () => {
  render(InvestmentPrompt);
  await expect.element(page.getByText(m.amortisation_empty())).toBeVisible();
  const link = page.getByRole("link", { name: m.amortisation_empty_action() });
  await expect.element(link).toHaveAttribute("href", expect.stringContaining("/settings/tariff"));
});

test("a viewer who is not an admin is told what is missing and sent nowhere", async () => {
  admin = false;
  const view = await render(InvestmentPrompt);
  await expect.element(page.getByText(m.amortisation_empty())).toBeVisible();
  expect(view.container.querySelectorAll("a, button")).toHaveLength(0);
});
