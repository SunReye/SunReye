import "../../app.css";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { connect, type Transport } from "../api/core.ts";
import { MODULE } from "../builder/builder.harness.ts";
import { layout, scene } from "../live/live-scene.harness.ts";
import Hero from "./Hero.svelte";

// Software GL builds the scene slowly while other suites run.
const SLOW = { timeout: 20_000 };

vi.setConfig({ testTimeout: 60_000 });

/** How the core answers the scene's module types: at once, never, or not at all. */
let types: "answer" | "hold" | "fail" = "answer";
let held = Promise.withResolvers<void>();

/** Settles once the scene asks for its module types: its load has started. */
let loading = Promise.withResolvers<void>();

async function moduleTypes(): Promise<Response> {
  loading.resolve();

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
  loading = Promise.withResolvers();
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

  await hero();

  expect(page.getByText("3D-Ansicht lädt …").elements()).toHaveLength(0);
  expect(flowShown()).toBe(false);
  await expect.element(page.getByText("3D-Ansicht lädt …"), SLOW).toBeVisible();

  held.resolve();

  await expect.element(sceneFigure(), SLOW).toBeVisible();
  await expect.poll(() => page.getByText("3D-Ansicht lädt …").elements(), SLOW).toHaveLength(0);
});

test("a failed load leaves the 2D flow with a retry that loads the scene", async () => {
  types = "fail";

  await hero();

  await expect.element(page.getByText(/^3D-Ansicht nicht geladen/u), SLOW).toBeVisible();
  // The flow's nodes fill in the frames after the hero mounts.
  await expect.poll(flowShown).toBe(true);

  types = "answer";
  await page.getByRole("button", { name: "Erneut versuchen" }).click();

  await expect.element(sceneFigure(), SLOW).toBeVisible();
  await expect.poll(flowShown, SLOW).toBe(false);
});

test("the first switch from 2D keeps the flow until the scene fades in over it", async () => {
  localStorage.setItem("sunreye.dashboard", "2d");
  types = "hold";

  await hero();
  await expect.poll(flowShown).toBe(true);
  // The load's own clock: its one-second notice is due when the test says so.
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  await page.getByRole("radio", { name: "3D" }).click();
  await loading.promise;
  vi.advanceTimersByTime(1500);
  await Promise.resolve();

  expect(flowShown()).toBe(true);
  expect(page.getByText("3D-Ansicht lädt …").elements()).toHaveLength(0);

  vi.useRealTimers();
  held.resolve();

  await expect.element(sceneFigure(), SLOW).toBeVisible();
  await expect.poll(flowShown, SLOW).toBe(false);
});
