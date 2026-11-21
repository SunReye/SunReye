// A placeholder stands at the size of what replaces it (ADR 21): loading, the builder's room.
import "../../app.css";
import { expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { connect } from "../api/core.ts";
import { DEVICES } from "../builder/builder.harness.ts";
import LayoutStep from "./LayoutStep.svelte";

test("while the builder loads, its placeholder takes the room under the header", async () => {
  await page.viewport(390, 800);

  // Nothing is answered: the builder stays loading.
  const core = connect({
    base: "http://core.test/",
    fetch: () => Promise.withResolvers<Response>().promise,
  });

  await render(LayoutStep, {
    core,
    devices: DEVICES,
    step: 4,
    count: 5,
    onback: () => {},
    ondone: () => {},
  });

  const loading = page.getByRole("status", { name: "Die Szene wird geladen …" });

  await expect.element(loading).toBeVisible();

  const header = document.querySelector("main")?.firstElementChild?.getBoundingClientRect();
  const box = loading.element().getBoundingClientRect();

  expect(box.top).toBe(header?.bottom);
  expect(box.bottom).toBe(window.innerHeight);
});
