import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import type { Layout } from "../lib/api/core.ts";
import { getLocale, setLocale } from "../lib/paraglide/runtime.js";
import Page from "./+page.svelte";

const DASHBOARD = "sunreye.dashboard";
const LOW_POWER = "sunreye.low-power";

/** A 10 m × 8 m gable house with nothing on its roof. */
const withScene: Layout = {
  appliesFrom: "2026-11-01T00:00:00Z",
  strings: [],
  warnings: [],
  scene: {
    north: 0,
    blocks: [
      { x: 0, z: 0, width: 10, depth: 8, eave: 3, rotation: 0, roof: { kind: "gable", pitch: 35 } },
    ],
    obstacles: [],
  },
};

const pass = globalThis.fetch.bind(globalThis);

/** The paths the page asked the core for, in order. */
const paths: string[] = [];

/** What the core serves at its layout: the layout with a scene once a test says so. */
const served = { scene: false };

/** The core's answer at `pathname`. */
function answer(pathname: string): Response | undefined {
  switch (pathname) {
    case "/api/v1/layout":
      return served.scene
        ? Response.json(withScene)
        : Response.json({ status: 404, code: "layout.none" }, { status: 404 });
    case "/api/v1/module-types":
      return Response.json({ moduleTypes: [] });
    case "/api/v1/capabilities":
      return Response.json({ code: "auth.required" }, { status: 401 });
    case "/api/v1/live":
      // The snapshot, then a stream held open: one that ends reconnects at once.
      return new Response(
        new ReadableStream({
          start: (controller) => {
            controller.enqueue(
              new TextEncoder().encode('event: snapshot\ndata: {"devices":{}}\n\n'),
            );
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      );
    default:
      return undefined;
  }
}

/** Waits until the page asked the core for `path` and a frame passed for its answer to show. */
async function asked(path: string): Promise<void> {
  await expect
    .poll(() => {
      return paths.includes(path);
    })
    .toBe(true);
  await new Promise<void>((painted) => {
    requestAnimationFrame(() => {
      painted();
    });
  });
}

beforeEach(async () => {
  localStorage.removeItem(DASHBOARD);
  localStorage.removeItem(LOW_POWER);
  paths.length = 0;
  served.scene = false;
  // The core answers the API; everything else, the WASM too, passes through.
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- fetch's own parameters are mutable.
  vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), location.href);

    paths.push(url.pathname);

    return Promise.resolve(answer(url.pathname) ?? pass(input, init));
  });
  await page.viewport(1280, 900);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await setLocale("de", { reload: false });
});

test("the home screen renders its main landmark", async () => {
  const screen = await render(Page);
  await expect.element(screen.getByRole("main")).toBeInTheDocument();
});

test("the screen is German until the owner picks English, which outlives a reload", async () => {
  const screen = await render(Page);

  await expect.element(screen.getByRole("combobox", { name: "Sprache" })).toBeVisible();
  expect(document.documentElement.lang).toBe("de");

  await userEvent.selectOptions(
    screen.getByRole("combobox", { name: "Sprache" }).element(),
    "English",
  );

  await expect.element(screen.getByRole("combobox", { name: "Language" })).toBeVisible();
  expect(document.documentElement.lang).toBe("en");
  // The strategy reads local storage first, as a reload does.
  expect(getLocale()).toBe("en");
});

test("without a scene the dashboard shows the 2D flow and offers no toggle", async () => {
  const screen = await render(Page);

  await asked("/api/v1/layout");
  expect(screen.getByLabelText("3D-Szene des Hauses").query()).toBeNull();
  expect(screen.getByRole("button", { name: "2D-Ansicht" }).query()).toBeNull();
});

test("with a scene the dashboard opens on it, and the toggle's 2D outlives a reload", async () => {
  served.scene = true;

  const first = await render(Page);

  await expect.element(first.getByLabelText("3D-Szene des Hauses")).toBeVisible();
  await first.getByRole("button", { name: "2D-Ansicht" }).click();
  await expect.element(first.getByRole("button", { name: "3D-Ansicht" })).toBeVisible();
  expect(first.getByLabelText("3D-Szene des Hauses").query()).toBeNull();
  await first.unmount();

  const again = await render(Page);

  await expect.element(again.getByRole("button", { name: "3D-Ansicht" })).toBeVisible();
  expect(again.getByLabelText("3D-Szene des Hauses").query()).toBeNull();
});

test("the low-power switch shows the 2D flow", async () => {
  served.scene = true;

  const screen = await render(Page);

  await expect.element(screen.getByLabelText("3D-Szene des Hauses")).toBeVisible();
  await screen.getByRole("checkbox", { name: "Stromsparmodus" }).click();

  await expect.element(screen.getByLabelText("3D-Szene des Hauses")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "2D-Ansicht" }).query()).toBeNull();
});

test("without WebGL2 a scene still leaves the 2D flow", async () => {
  served.scene = true;
  // No context at all: the dashboard asks only for WebGL2.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);

  const screen = await render(Page);

  await asked("/api/v1/layout");
  expect(screen.getByLabelText("3D-Szene des Hauses").query()).toBeNull();
  expect(screen.getByRole("button", { name: "2D-Ansicht" }).query()).toBeNull();
});
