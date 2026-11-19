import "../../app.css";
import { setMode } from "mode-watcher";
import { afterEach, beforeEach, expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import type { Problem } from "../api/client.ts";
import type { ApiDocument } from "../api/reference.ts";
import ApiReference from "./ApiReference.svelte";

// Scalar draws the reference slowly while other suites run.
const SLOW = { timeout: 15_000 };

const DOCUMENT = {
  openapi: "3.1.0",
  servers: [{ url: "http://core.test/prefix" }],
  info: { title: "SunReye", version: "1" },
  tags: [{ name: "views" }],
  paths: {
    "/api/v1/views": {
      get: {
        tags: ["views"],
        summary: "Every saved view",
        operationId: "list_views",
        responses: { 200: { description: "The views" } },
      },
    },
  },
};

/** A core that answers the reference with `answer`. */
const core = (answer: ApiDocument | Problem) => ({ reference: () => Promise.resolve(answer) });

beforeEach(() => {
  performance.clearResourceTimings();
  location.hash = "#/api";
  setMode("dark");
});

afterEach(() => {
  setMode("system");
});

test("the reference shows the core's operations, and reaches nothing past the page", async () => {
  const screen = await render(ApiReference, { core: core(DOCUMENT) });

  await expect
    .element(screen.getByRole("heading", { name: "Every saved view" }), SLOW)
    .toBeVisible();
  // The document came from the core: no fonts, no proxy, no telemetry from elsewhere.
  expect(
    performance
      .getEntriesByType("resource")
      // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the DOM's own type.
      .filter(({ name }) => !name.startsWith(location.origin)),
  ).toEqual([]);
});

test("following the reference leaves the router's hash as it was", async () => {
  const screen = await render(ApiReference, { core: core(DOCUMENT) });

  await expect
    .element(screen.getByRole("heading", { name: "Every saved view" }), SLOW)
    .toBeVisible();

  for (const link of screen.container.querySelectorAll<HTMLAnchorElement>("a[href^='#']"))
    link.click();

  expect(location.hash).toBe("#/api");
});

test("the reference wears the app's theme, follows it, and leaves the page's body as it was", async () => {
  const before = document.body.className;
  const screen = await render(ApiReference, { core: core(DOCUMENT) });

  await expect
    .element(screen.getByRole("heading", { name: "Every saved view" }), SLOW)
    .toBeVisible();
  expect(document.body.classList.contains("dark-mode")).toBe(true);

  setMode("light");
  await expect.poll(() => document.body.classList.contains("light-mode"), SLOW).toBe(true);

  await screen.unmount();
  expect(document.body.className).toBe(before);
});

test("a document the core cannot give says so", async () => {
  const screen = await render(ApiReference, { core: core({ problem: "http.502" }) });

  await expect.element(screen.getByRole("alert")).toBeVisible();
});
