import { createRawSnippet } from "svelte";
import { toast } from "svelte-sonner";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { clearToasts, holdToasts } from "../components/toasts.harness.ts";
import { finish } from "../motion/animations.harness.ts";
import { motion } from "../../../../../../packages/builder/src/motion/tier.svelte.ts";
import Shell from "./Shell.svelte";
import "../../app.css";

/** SvelteKit's `goto`, which the root layout passes: no router runs here. */
const goto = vi.fn((_url: string) => Promise.resolve());

const children = createRawSnippet(() => ({ render: () => "<p>page</p>" }));

beforeEach(holdToasts);

afterEach(async () => {
  await clearToasts();
  motion.lowPower = false;
  localStorage.clear();
});

/** The shown toast's box. */
async function toastBox(text: string): Promise<DOMRect> {
  toast.success(text);
  await expect.element(page.getByText(text)).toBeVisible();

  const shown = page.getByText(text).element().closest("[data-sonner-toast]");

  // Its entrance has ended.
  await finish(() => shown?.getAnimations().length === 0);

  return shown!.getBoundingClientRect();
}

test("the shell holds the toaster: a toast shows at the bottom right beside the rail", async () => {
  await page.viewport(1280, 800);
  motion.lowPower = true;
  await render(Shell, { shell: "rail", current: "/", admin: false, goto, children });

  const box = await toastBox("Gespeichert");

  expect(box.left).toBeGreaterThan(640);
  expect(box.top).toBeGreaterThan(400);
  expect(box.bottom).toBeLessThanOrEqual(800);
});

test("on the phone a toast sits above the bottom bar", async () => {
  await page.viewport(390, 844);
  motion.lowPower = true;
  const screen = await render(Shell, { shell: "bar", current: "/", admin: false, goto, children });
  const bar = screen.getByRole("navigation", { name: "Hauptnavigation" }).element();

  const box = await toastBox("Entfernt");

  expect(box.bottom).toBeLessThanOrEqual(bar.getBoundingClientRect().top);
  expect(box.top).toBeGreaterThan(422);
});

test("around setup, with no bar or rail, a toast still shows on the phone", async () => {
  await page.viewport(390, 844);
  motion.lowPower = true;
  await render(Shell, { shell: "bare", current: "/", admin: false, goto, children });

  const box = await toastBox("Gespeichert.");

  expect(box.top).toBeGreaterThan(422);
  expect(box.bottom).toBeLessThanOrEqual(844);
});
