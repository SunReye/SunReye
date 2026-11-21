import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
// The screen is laid out by the SPA's utilities.
import "../../app.css";
import { reset, show, showIn } from "./explore.harness.ts";
import { closed, finish } from "../motion/animations.harness.ts";
import { settle } from "../motion/clock.harness.ts";

afterEach(reset);

// Headless Chromium grants fullscreen and then refuses to be resized: by default the tests' browser
// has none, as iPhone Safari; `browser()` gives it one.
beforeEach(() => {
  Object.defineProperty(document, "fullscreenEnabled", { configurable: true, value: false });
});

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(document, "fullscreenEnabled");
  Reflect.deleteProperty(document, "fullscreenElement");
});

const desk = () => page.viewport(1280, 800);

const canvas = () => document.querySelector("canvas")!;

/** The first lane's backing store, which only a redraw resizes. */
const drawn = () => ({ width: canvas().width, height: canvas().height });

const main = () => document.querySelector("main")!.getBoundingClientRect();

test("fullscreen fills the window with the chart, the range and the mode, outside the route", async () => {
  await desk();

  const { screen, went } = await show();

  await expect.element(screen.getByRole("region", { name: "Reihen" })).toBeVisible();

  const steps = went.length;

  await screen.getByRole("button", { name: "Vollbild", exact: true }).click();

  await expect.element(screen.getByRole("button", { name: "Vollbild beenden" })).toBeVisible();
  await expect.element(screen.getByRole("region", { name: "Reihen" })).toBeVisible();
  await expect.element(screen.getByRole("radio", { name: "Tag" })).toBeVisible();
  await expect.element(screen.getByRole("radio", { name: "Überlagern" })).toBeVisible();
  expect(screen.getByRole("complementary", { name: "Reihen wählen" }).query()).toBeNull();
  expect(screen.getByRole("list", { name: "Gewählte Reihen" }).query()).toBeNull();
  expect(screen.getByRole("button", { name: "Als CSV exportieren" }).query()).toBeNull();
  expect(main()).toMatchObject({ left: 0, top: 0, width: 1280, height: 800 });

  await screen.getByRole("button", { name: "Vollbild beenden" }).click();

  await expect.element(screen.getByRole("complementary", { name: "Reihen wählen" })).toBeVisible();
  await expect.element(screen.getByRole("list", { name: "Gewählte Reihen" })).toBeVisible();
  await expect.element(screen.getByRole("button", { name: "Als CSV exportieren" })).toBeVisible();
  expect(went).toHaveLength(steps);
});

test("overlay's periods are hidden in fullscreen, its legend names them", async () => {
  await desk();

  const { screen } = await show("mode=overlay&range=day&at=2026-11-10&vs=2026-11-03");
  const chart = screen.getByRole("region", { name: "Überlagern" });

  await expect.element(chart.getByRole("button", { name: "Tag davor" })).toBeVisible();

  await screen.getByRole("button", { name: "Vollbild", exact: true }).click();

  await expect.element(screen.getByRole("button", { name: "Vollbild beenden" })).toBeVisible();
  await expect.element(chart.getByText("Vergleichen mit")).not.toBeVisible();
  expect(chart.getByRole("button", { name: "Tag davor" }).query()).toBeNull();
  expect(chart.getByRole("button", { name: "Di., 3. November entfernen" }).query()).toBeNull();
  await expect.element(chart.getByRole("img", { name: /Di\., 3\. November/u })).toBeVisible();

  await screen.getByRole("button", { name: "Vollbild beenden" }).click();

  await expect.element(chart.getByRole("button", { name: "Tag davor" })).toBeVisible();
});

test("the lanes redraw at the window's size in fullscreen and at their own again out of it", async () => {
  await desk();

  const { screen } = await show();

  // The canvas is sized to what its size observer is told.
  await settle(() => (document.querySelector("canvas")?.height ?? 0) > 0);

  const before = drawn();

  await screen.getByRole("button", { name: "Vollbild", exact: true }).click();

  await settle(() => drawn().width > before.width && drawn().height > before.height);
  // The chart ends at the window's edge: nothing scrolls.
  expect(main().bottom).toBe(800);
  expect(
    document.querySelector("main [data-slot=card]")!.getBoundingClientRect().bottom,
  ).toBeLessThan(800);

  await screen.getByRole("button", { name: "Vollbild beenden" }).click();

  await settle(() => drawn().width === before.width && drawn().height === before.height);
});

/** A browser that grants fullscreen: what is fullscreen, and its own way out. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- an options bag.
function browser({ refuses = false } = {}) {
  let element: Element | null = null;

  const set = (to: Element | null) => {
    element = to;
    document.dispatchEvent(new Event("fullscreenchange"));
  };

  Object.defineProperty(document, "fullscreenEnabled", { configurable: true, value: true });
  Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => element });
  vi.spyOn(Element.prototype, "requestFullscreen").mockImplementation(function request(
    this: Element,
  ) {
    if (refuses) return Promise.reject(new TypeError("refused"));

    set(this);

    return Promise.resolve();
  });
  vi.spyOn(document, "exitFullscreen").mockImplementation(() => {
    set(null);

    return Promise.resolve();
  });

  return {
    get element() {
      return element;
    },
    /** The browser's own way out: its Esc, its gesture. */
    leave: () => {
      set(null);
    },
  };
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the browser's locator.
const picker = (screen: Awaited<ReturnType<typeof show>>["screen"]) =>
  screen.getByRole("complementary", { name: "Reihen wählen" });

test("where the browser grants it the page goes fullscreen, and the browser's way out restores the screen", async () => {
  await desk();

  const tab = browser();
  const { screen } = await show();

  await screen.getByRole("button", { name: "Vollbild", exact: true }).click();

  // The page, not the chart: the range's calendar and lists open on the body.
  await expect.poll(() => tab.element).toBe(document.documentElement);
  await expect.element(screen.getByRole("button", { name: "Vollbild beenden" })).toBeVisible();

  tab.leave();

  await expect.element(screen.getByRole("button", { name: "Vollbild", exact: true })).toBeVisible();
  await expect.element(picker(screen)).toBeVisible();
});

test("the button leaves the browser's fullscreen too", async () => {
  await desk();

  const tab = browser();
  const { screen } = await show();

  await screen.getByRole("button", { name: "Vollbild", exact: true }).click();
  await screen.getByRole("button", { name: "Vollbild beenden" }).click();

  await expect.poll(() => tab.element).toBeNull();
  await expect.element(picker(screen)).toBeVisible();
});

test("a browser that refuses fullscreen still has the window filled", async () => {
  await desk();

  browser({ refuses: true });

  const { screen } = await show();

  await screen.getByRole("button", { name: "Vollbild", exact: true }).click();

  await expect.element(screen.getByRole("button", { name: "Vollbild beenden" })).toBeVisible();
  expect(main()).toMatchObject({ width: 1280, height: 800 });
});

test("leaving the screen leaves the browser's fullscreen", async () => {
  await desk();

  const tab = browser();
  const { screen } = await show();

  await screen.getByRole("button", { name: "Vollbild", exact: true }).click();
  await expect.poll(() => tab.element).not.toBeNull();

  await screen.unmount();

  expect(tab.element).toBeNull();
});

test("Esc leaves a filled window, after it closed a list open over it", async () => {
  await desk();

  const { screen } = await show();

  await screen.getByRole("button", { name: "Vollbild", exact: true }).click();
  await screen.getByRole("radio", { name: "Frei" }).click();
  // A list on the body lies over the filled window, and takes a pick.
  await screen.getByRole("combobox", { name: "Bis Uhrzeit" }).click();
  await page.getByRole("option", { name: "12 Uhr", exact: true }).click();
  await closed(page.getByRole("listbox"));
  await expect
    .element(screen.getByRole("combobox", { name: "Bis Uhrzeit" }))
    .toHaveTextContent("12 Uhr");

  await screen.getByRole("combobox", { name: "Von Uhrzeit" }).click();
  await expect.element(page.getByRole("listbox")).toBeVisible();

  await userEvent.keyboard("{Escape}");

  await closed(page.getByRole("listbox"));
  await expect.element(screen.getByRole("button", { name: "Vollbild beenden" })).toBeVisible();

  await userEvent.keyboard("{Escape}");

  await expect.element(screen.getByRole("button", { name: "Vollbild", exact: true })).toBeVisible();
  await expect.element(picker(screen)).toBeVisible();
});

test.for([
  { shell: "bar", width: 390, height: 844, role: "radio" },
  { shell: "rail", width: 1280, height: 800, role: "link" },
] as const)(
  "without the browser's fullscreen the screen lies over the $shell",
  async ({ shell, width, height, role }) => {
    await page.viewport(width, height);

    const screen = await showIn(shell);
    const item = screen.getByRole(role, { name: "Verlauf" });

    const covered = () => {
      const box = item.element().getBoundingClientRect();
      const top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);

      return document.querySelector("main")!.contains(top);
    };

    // The slide in from the dashboard is over: only this screen is left, at rest.
    await finish(() => {
      const screens = [...document.querySelectorAll("[data-screen]")];

      return screens.length === 1 && screens[0]!.getAnimations().length === 0;
    });
    await expect.element(item).toBeVisible();
    expect(covered()).toBe(false);

    await screen.getByRole("button", { name: "Vollbild", exact: true }).click();

    await expect.poll(covered).toBe(true);
    expect(main()).toMatchObject({ left: 0, top: 0, width, height });
  },
);

test("on a phone fullscreen stays out of the route, and lying down puts the range beside the mode", async () => {
  await page.viewport(390, 844);

  const { screen, went } = await show();

  await expect.element(screen.getByRole("region", { name: "Reihen" })).toBeVisible();

  const steps = went.length;

  await screen.getByRole("button", { name: "Vollbild", exact: true }).click();
  await expect.element(screen.getByRole("button", { name: "Vollbild beenden" })).toBeVisible();

  await page.viewport(844, 390);

  const top = (role: "radio" | "button", name: string) =>
    screen.getByRole(role, { name }).element().getBoundingClientRect().top;

  // One row of controls leaves the short window to the chart.
  await expect.poll(() => Math.abs(top("radio", "Tag") - top("radio", "Falten"))).toBeLessThan(8);
  expect(Math.abs(top("button", "Früher") - top("radio", "Falten"))).toBeLessThan(8);

  await screen.getByRole("button", { name: "Vollbild beenden" }).click();

  await expect.element(screen.getByRole("list", { name: "Gewählte Reihen" })).toBeVisible();
  expect(went).toHaveLength(steps);
});
