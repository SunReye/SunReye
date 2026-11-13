import { createRawSnippet, flushSync } from "svelte";
import { afterEach, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { haptics } from "../haptics.ts";
import { motion } from "../motion/tier.svelte.ts";
import Shell from "./Shell.svelte";
import "../../app.css";

/** SvelteKit's `goto`, which the root layout passes: no router runs here. */
const goto = vi.fn((_url: string) => Promise.resolve());

const children = createRawSnippet(() => ({ render: () => "<p>page</p>" }));

/** The rail surface's horizontal offset as it is drawn now, mid-transition too. */
function offset(): number {
  const surface = document.querySelector("[data-rail-surface]")!;

  return new DOMMatrix(getComputedStyle(surface).transform).m41;
}

afterEach(() => {
  motion.lowPower = false;
  vi.restoreAllMocks();
  localStorage.clear();
  // The rail's links move the hash.
  history.replaceState(null, "", location.pathname + location.search);
});

test("with a mouse the rail starts as icons and expands on hover", async () => {
  await page.viewport(1280, 800);
  const screen = await render(Shell, { shell: "rail", current: "/", admin: false, goto, children });
  const rail = screen.getByRole("navigation", { name: "Hauptnavigation" });

  await expect.element(rail).toHaveAttribute("data-expanded", "false");

  await screen.getByRole("link", { name: "Verlauf" }).hover();

  await expect.element(rail).toHaveAttribute("data-expanded", "true");
});

test("with a mouse the rail collapses a moment after the cursor leaves", async () => {
  await page.viewport(1280, 800);
  const screen = await render(Shell, { shell: "rail", current: "/", admin: false, goto, children });
  const rail = screen.getByRole("navigation", { name: "Hauptnavigation" });

  await screen.getByRole("link", { name: "Verlauf" }).hover();
  await screen.getByText("page").hover();

  // Still open right after the cursor left.
  expect(rail.element().matches("[data-expanded=true]")).toBe(true);
  await expect.element(rail).toHaveAttribute("data-expanded", "false");
});

test("keyboard focus expands the rail", async () => {
  await page.viewport(1280, 800);
  const screen = await render(Shell, { shell: "rail", current: "/", admin: false, goto, children });

  await userEvent.tab();

  await expect
    .element(screen.getByRole("navigation", { name: "Hauptnavigation" }))
    .toHaveAttribute("data-expanded", "true");
});

test("on touch at 768 px and wider the logo opens the rail and a tap outside closes it", async () => {
  await page.viewport(1024, 800);

  const screen = await render(Shell, {
    shell: "rail-open",
    current: "/",
    admin: false,
    goto,
    children,
  });

  const rail = screen.getByRole("navigation", { name: "Hauptnavigation" });

  await expect.element(rail).toHaveAttribute("data-expanded", "false");

  await screen.getByRole("link", { name: "SunReye" }).click();

  await expect.element(rail).toHaveAttribute("data-expanded", "true");

  await screen.getByText("page").click();

  await expect.element(rail).toHaveAttribute("data-expanded", "false");
});

test("on touch a pinned rail stays open after a tap outside", async () => {
  await page.viewport(1024, 800);

  const screen = await render(Shell, {
    shell: "rail-open",
    current: "/",
    admin: false,
    goto,
    children,
  });

  const rail = screen.getByRole("navigation", { name: "Hauptnavigation" });

  await screen.getByRole("link", { name: "SunReye" }).click();
  await screen.getByRole("button", { name: "Anheften" }).click();
  await screen.getByText("page").click();

  await expect.element(rail).toHaveAttribute("data-expanded", "true");
});

test("on touch narrower than 768 px there is no rail", async () => {
  await page.viewport(400, 800);
  const screen = await render(Shell, { shell: "bar", current: "/", admin: false, goto, children });

  await expect.element(screen.getByText("page")).toBeVisible();
  expect(document.querySelector("nav.rail")).toBeNull();
});

test("expanding never moves the content", async () => {
  await page.viewport(1280, 800);
  const screen = await render(Shell, { shell: "rail", current: "/", admin: false, goto, children });
  const content = screen.getByText("page");

  // After the route's entrance.
  for (const animation of document.getAnimations()) animation.finish();

  const before = content.element().getBoundingClientRect();

  await screen.getByRole("link", { name: "Verlauf" }).hover();
  await expect
    .element(screen.getByRole("navigation", { name: "Hauptnavigation" }))
    .toHaveAttribute("data-expanded", "true");

  expect(content.element().getBoundingClientRect().toJSON()).toEqual(before.toJSON());
});

test("the pin is kept per browser", async () => {
  await page.viewport(1280, 800);
  const first = await render(Shell, { shell: "rail", current: "/", admin: false, goto, children });

  await first.getByRole("link", { name: "Verlauf" }).hover();
  await first.getByRole("button", { name: "Anheften" }).click();
  await first.unmount();

  const screen = await render(Shell, { shell: "rail", current: "/", admin: false, goto, children });

  await expect
    .element(screen.getByRole("navigation", { name: "Hauptnavigation" }))
    .toHaveAttribute("data-expanded", "true");
});

test("Controls appears only for admins", async () => {
  await page.viewport(1280, 800);
  const viewer = await render(Shell, { shell: "rail", current: "/", admin: false, goto, children });

  await expect.element(viewer.getByRole("link", { name: "Verlauf" })).toBeInTheDocument();
  expect(viewer.getByRole("link", { name: /Steuerung/u }).query()).toBeNull();
  await viewer.unmount();

  const admin = await render(Shell, { shell: "rail", current: "/", admin: true, goto, children });

  await expect
    .element(admin.getByRole("link", { name: /Steuerung/u }))
    .toHaveAttribute("href", "#/controls");
});

test("the shown route is marked current", async () => {
  await page.viewport(1280, 800);

  const screen = await render(Shell, {
    shell: "rail",
    current: "/history",
    admin: false,
    goto,
    children,
  });

  await expect
    .element(screen.getByRole("link", { name: "Verlauf" }))
    .toHaveAttribute("aria-current", "page");
});

test("a reversed expand continues from where it is", async () => {
  await page.viewport(1280, 800);
  const screen = await render(Shell, { shell: "rail", current: "/", admin: false, goto, children });
  const pin = screen.getByRole("button", { name: "Anheften" }).element();
  const collapsed = offset();

  // Clicks without the pointer, which would expand the rail by hovering it; one task, no frame.
  flushSync(() => {
    pin.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  const [expanding] = document.querySelector("[data-rail-surface]")!.getAnimations();
  expanding!.currentTime = 150;
  const halfway = offset();

  flushSync(() => {
    pin.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });

  expect(halfway).toBeGreaterThan(collapsed);
  expect(halfway).toBeLessThan(0);
  expect(offset()).toBeCloseTo(halfway, 0);
});

test("pinning taps soft and moving to another screen ticks selection", async () => {
  await page.viewport(1280, 800);

  const soft = vi.spyOn(haptics, "soft");
  const selection = vi.spyOn(haptics, "selection");
  const screen = await render(Shell, { shell: "rail", current: "/", admin: false, goto, children });

  await screen.getByRole("link", { name: "Verlauf" }).hover();
  await screen.getByRole("button", { name: "Anheften" }).click();

  expect(soft).toHaveBeenCalledOnce();

  await screen.getByRole("link", { name: "Dashboard" }).click();

  expect(selection).not.toHaveBeenCalled();

  await screen.getByRole("link", { name: "Verlauf" }).click();

  expect(selection).toHaveBeenCalledOnce();
});

/** The screens in the page now: two while one cross-fades into the next. */
function screens(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>("[data-screen]")];
}

test("a route change cross-fades the screens", async () => {
  const screen = await render(Shell, { shell: "bar", current: "/", admin: false, goto, children });

  await screen.rerender({ current: "/history" });

  const [leaving, arriving] = screens();

  expect(screens()).toHaveLength(2);
  expect(leaving?.getAnimations()).not.toHaveLength(0);
  expect(arriving?.getAnimations()).not.toHaveLength(0);
  await expect.poll(() => screens()).toHaveLength(1);
});

test("with low power a route change is instant", async () => {
  motion.lowPower = true;

  const screen = await render(Shell, { shell: "bar", current: "/", admin: false, goto, children });

  await screen.rerender({ current: "/history" });

  expect(screens()).toHaveLength(1);
  expect(screens()[0]?.getAnimations()).toHaveLength(0);
});

test("a screen as tall as the screen less the bar ends above the bar", async () => {
  await page.viewport(390, 844);

  const full = createRawSnippet(() => ({
    render: () =>
      `<main data-testid="full" style="height: calc(100dvh - var(--bar-clear, 0px))"></main>`,
  }));

  const screen = await render(Shell, {
    shell: "bar",
    current: "/",
    admin: false,
    goto,
    children: full,
  });

  const bar = screen.getByRole("navigation", { name: "Hauptnavigation" }).element();
  const bottom = screen.getByTestId("full").element().getBoundingClientRect().bottom;

  expect(bottom).toBeLessThanOrEqual(bar.getBoundingClientRect().top);
});
