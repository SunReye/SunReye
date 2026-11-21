import "../../app.css";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { connect, type Transport } from "../api/core.ts";
import { MODULE, press } from "../builder/builder.harness.ts";
import { layout, scene } from "../live/live-scene.harness.ts";
import Hero from "./Hero.svelte";
import { settle } from "../motion/clock.harness.ts";

vi.setConfig({ testTimeout: 60_000 });

/** How the core answers the scene's module types: at once, never, or not at all. */
let types: "answer" | "hold" | "fail" = "answer";
let held = Promise.withResolvers<void>();

/** Whether the scene has asked for its module types: its load, begun in idle time, has started. */
let loading = false;

async function moduleTypes(): Promise<Response> {
  loading = true;

  if (types === "fail") throw new TypeError("offline");

  if (types === "hold") await held.promise;

  return Response.json({ moduleTypes: [MODULE] });
}

const transport: Transport = {
  base: "http://core.test/",
  fetch: (request) => {
    const path = new URL(request.url).pathname;

    if (path === "/api/v1/module-types") return moduleTypes();

    // A viewer's: no location, no capabilities.
    if (path === "/api/v1/location" || path === "/api/v1/capabilities") {
      return Promise.resolve(Response.json({ code: "auth.forbidden" }, { status: 403 }));
    }

    // The live stream and the layout stay silent.
    return Promise.withResolvers<Response>().promise;
  },
};

beforeEach(async () => {
  localStorage.clear();
  types = "answer";
  held = Promise.withResolvers();
  loading = false;
  await page.viewport(1000, 800);
});

afterEach(() => {
  vi.useRealTimers();
  held.resolve();
});

const hero = () =>
  render(Hero, {
    core: connect(transport),
    layout: { ...layout, scene },
    admin: true,
    live: undefined,
    plant: undefined,
    plantStale: undefined,
    onselect: () => {},
    class: "h-[600px] w-[800px]",
  });

const sceneFigure = () => page.getByRole("figure", { name: "Live-Ansicht des Hauses" });

/** Whether the 2D flow shows: its hub, outside the scene. */
const flowShown = () =>
  page
    .getByRole("button", { name: "Wechselrichter: Details" })
    .elements()
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the DOM's element.
    .map((button) => button.closest("figure"))
    .includes(null);

test("the scene's studio holds the hero while it loads; after a second it says so", async () => {
  types = "hold";
  // The load's own clock: its one-second notice is due when the test says so.
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

  await hero();
  await settle(() => loading);

  expect(page.getByText("3D-Ansicht lädt …").elements()).toHaveLength(0);
  expect(flowShown()).toBe(false);

  vi.advanceTimersByTime(1500);
  vi.useRealTimers();

  await expect.element(page.getByText("3D-Ansicht lädt …")).toBeVisible();

  held.resolve();

  await settle(() => sceneFigure().query() !== null);
  await expect.element(sceneFigure()).toBeVisible();
  await settle(() => page.getByText("3D-Ansicht lädt …").query() === null);
});

test("a failed load leaves the 2D flow with a retry that loads the scene", async () => {
  types = "fail";

  await hero();

  await settle(() => page.getByText(/^3D-Ansicht nicht geladen/u).query() !== null);
  await expect.element(page.getByText(/^3D-Ansicht nicht geladen/u)).toBeVisible();
  expect(flowShown()).toBe(true);

  types = "answer";
  await page.getByRole("button", { name: "Erneut laden" }).click();

  await settle(() => sceneFigure().query() !== null);
  await expect.element(sceneFigure()).toBeVisible();
  await settle(() => !flowShown());
});

test("the first switch from 2D keeps the flow until the scene fades in over it", async () => {
  localStorage.setItem("sunreye.dashboard", "2d");
  types = "hold";

  await hero();
  // The load's own clock: its one-second notice is due when the test says so.
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  await page.getByRole("radio", { name: "3D" }).click();
  await settle(() => loading);
  vi.advanceTimersByTime(1500);
  await Promise.resolve();

  expect(flowShown()).toBe(true);
  expect(page.getByText("3D-Ansicht lädt …").elements()).toHaveLength(0);

  vi.useRealTimers();
  held.resolve();

  await settle(() => sceneFigure().query() !== null);
  await expect.element(sceneFigure()).toBeVisible();
  await settle(() => !flowShown());
});

/** Where each browser keeps the view it orbited to. */
const KEPT = "sunreye.dashboard.view";

/** One finger down the canvas's middle, upwards: a scroll of the page, or an orbit. */
async function swipe(): Promise<void> {
  const { left, top, width, height } = page
    .getByLabelText("3D-Szene des Hauses")
    .element()
    .getBoundingClientRect();

  const x = left + width / 2;
  const from = top + height * 0.7;

  await press(
    "touch",
    Array.from({ length: 9 }, (_, step) => [x, from - step * 30]),
  );
}

test("the camera is locked: one finger is the page's, until the lock is opened", async () => {
  await hero();
  await settle(() => sceneFigure().query() !== null);
  await expect.element(sceneFigure()).toBeVisible();
  await settle(() => getComputedStyle(sceneFigure().element()).opacity === "1");

  const canvas = page.getByLabelText("3D-Szene des Hauses").element();

  // Locked, the browser scrolls the page by a vertical finger, and the camera does not follow it.
  expect(getComputedStyle(canvas).touchAction).toBe("pan-y");
  await swipe();
  expect(localStorage.getItem(KEPT)).toBeNull();

  await page.getByRole("button", { name: "Kamera bewegen" }).click();
  await settle(() => getComputedStyle(canvas).touchAction === "none");
  await swipe();

  // The orbit ends with the finger and keeps the view it reached.
  await settle(() => localStorage.getItem(KEPT) !== null);
});
