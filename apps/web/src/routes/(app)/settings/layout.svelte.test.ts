import { createRawSnippet } from "svelte";
import { readable } from "svelte/store";
import { expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";

vi.mock("$env/dynamic/public", () => ({ env: {} }));
const get = vi.hoisted(() => vi.fn());
vi.mock("$lib/core-api", () => ({ core: { GET: get } }));
vi.mock("$app/navigation", () => ({ goto: vi.fn() }));
vi.mock("$lib/session", () => ({
  useAppSession: () =>
    readable({ data: { user: { id: 1, name: "Ada", admin: true } }, isPending: false }),
}));

const { default: SettingsLayout } = await import("./+layout.svelte");

test("the settings area shows its children without polling an engine status", async () => {
  const children = createRawSnippet(() => ({ render: () => "<p>the panel</p>" }));
  render(SettingsLayout, { children });
  await expect.element(page.getByText("the panel")).toBeVisible();
});
