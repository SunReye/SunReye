import { expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import * as m from "$lib/paraglide/messages";

vi.mock("$env/dynamic/public", () => ({ env: {} }));
vi.mock("$lib/session", () => ({
  useAppSession: () => ({
    subscribe: (run: (v: unknown) => void) => {
      run({ data: { user: { admin: true } } });
      return () => {};
    },
  }),
}));

const { default: InvestmentPrompt } = await import("./investment-prompt.svelte");

// The core serves no investment setting, so the prompt names what is missing and
// does not send an admin to a settings panel that no longer exists.
test("names the missing investment and links nowhere, even for an admin", async () => {
  const view = await render(InvestmentPrompt);
  await expect.element(page.getByText(m.amortisation_empty())).toBeVisible();
  expect(view.container.querySelectorAll("a, button")).toHaveLength(0);
});
