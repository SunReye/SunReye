import { afterEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import "../../app.css";
import ErrorScreen from "./ErrorScreen.svelte";

afterEach(() => {
  delete document.documentElement.dataset.motion;
});

/** The animations running on the screen's mark. */
const moving = (root: Element) =>
  root.querySelector("[data-error-mark]")?.getAnimations({ subtree: true }).length;

test("a failure says what happened, in the app's surface, and offers a reload and the dashboard", async () => {
  const reload = vi.fn<() => void>();
  const screen = await render(ErrorScreen, { status: 500, message: "each_key_duplicate", reload });

  await expect
    .element(screen.getByRole("heading", { name: "Etwas ist schiefgelaufen" }))
    .toBeVisible();
  await expect.element(screen.getByText("Fehler 500 · each_key_duplicate")).toBeVisible();
  await expect
    .element(screen.getByRole("link", { name: "Zum Dashboard" }))
    .toHaveAttribute("href", "#/");
  expect(screen.container.querySelector(".glass-ambient")).not.toBeNull();

  await screen.getByRole("button", { name: "Neu laden" }).click();

  expect(reload).toHaveBeenCalledOnce();
});

test("an unknown address says so and leads to the dashboard; a reload would not help", async () => {
  const screen = await render(ErrorScreen, { status: 404, message: "Not Found", reload: vi.fn() });

  await expect.element(screen.getByRole("heading", { name: "Seite nicht gefunden" })).toBeVisible();
  await expect.element(screen.getByRole("link", { name: "Zum Dashboard" })).toBeVisible();
  await expect.element(screen.getByRole("button", { name: "Neu laden" })).not.toBeInTheDocument();
});

test("the mark moves, and rests on the still tier", async () => {
  const screen = await render(ErrorScreen, { status: 500, message: "", reload: vi.fn() });

  await expect.poll(() => moving(screen.container)).toBeGreaterThan(0);

  document.documentElement.dataset.motion = "still";

  await expect.poll(() => moving(screen.container)).toBe(0);
});
