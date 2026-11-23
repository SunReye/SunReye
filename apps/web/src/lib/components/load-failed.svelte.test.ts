import { afterEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import "../../app.css";
import { haptics } from "@sunreye/ui/haptics";
import LoadFailed from "./load-failed.svelte";

afterEach(() => {
  vi.restoreAllMocks();
});

test.each([
  ["inline", "alert"],
  ["block", "alert"],
  ["quiet", "status"],
] as const)("%s, it says what failed and reads again with a light tap", async (size, role) => {
  const light = vi.spyOn(haptics, "light");
  const onretry = vi.fn();

  await render(LoadFailed, { text: "Nicht gelesen.", size, onretry });

  const shown = page.getByRole(role);

  await expect.element(shown.getByText("Nicht gelesen.")).toBeVisible();
  await shown.getByRole("button", { name: "Erneut laden" }).click();

  expect(onretry).toHaveBeenCalledOnce();
  expect(light).toHaveBeenCalledOnce();
});

test("the block size adds a line on what still works", async () => {
  await render(LoadFailed, {
    text: "Nicht geladen",
    detail: "Live-Werte laufen weiter.",
    size: "block",
    onretry: () => {},
  });

  await expect.element(page.getByRole("heading", { name: "Nicht geladen" })).toBeVisible();
  await expect
    .element(page.getByRole("alert").getByText("Live-Werte laufen weiter."))
    .toBeVisible();
});
