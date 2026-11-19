import "../../app.css";
import { PerspectiveCamera } from "three";
import { afterEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import PerfOverlay from "./PerfOverlay.svelte";
import { perf } from "./perf.svelte.ts";
import { look } from "./probe.harness.ts";
import { quality } from "./quality.svelte.ts";
import { Studio } from "./studio.ts";

// The readout's own cost (ADR 21 "Measuring"): one probe on the studio it tells of, for as long
// as it shows, and none after.

let studio: Studio | undefined;
let release: (() => void) | undefined;

/** A studio the readout tells of, which outlives it. */
function shown(): Studio {
  const canvas = document.createElement("canvas");

  document.body.append(canvas);
  studio = new Studio(canvas, new PerspectiveCamera(40, 1, 0.1, 5000), () => look("low"));
  studio.setSize(64, 64);
  release = perf.show(studio);

  return studio;
}

afterEach(() => {
  vi.restoreAllMocks();
  release?.();
  studio?.dispose();
  studio?.renderer.domElement.remove();
  studio = undefined;
  quality.choice = "auto";
  history.replaceState(null, "", location.pathname + location.search);
  localStorage.clear();
});

test("the readout keeps its one probe while the 3D quality changes under it", async () => {
  location.hash = "#/?perf";

  const measure = vi.spyOn(shown(), "measure");
  const screen = await render(PerfOverlay);
  const readout = screen.getByRole("status", { name: "Leistungsanzeige" });
  const told = () => readout.query()?.textContent ?? "";

  await expect.poll(told).toMatch(/quality auto →/u);

  quality.choice = "low";
  // Told with the next reading.
  await expect.poll(told).toMatch(/quality low →/u);
  expect(measure).toHaveBeenCalledTimes(1);
});

test("the readout gone, nothing counts the studio's frames: its renderer is as it was", async () => {
  location.hash = "#/?perf";

  const opened = shown();
  const { renderer } = opened;
  // How the renderer binds a target, which three.js keeps as a property of its own.
  // oxlint-disable-next-line typescript/unbound-method -- compared, never called.
  const binds = () => renderer.setRenderTarget;
  const own = binds();
  // The probe the readout is given: the studio has one.
  const probe = opened.measure();
  const screen = await render(PerfOverlay);

  await expect.element(screen.getByRole("status", { name: "Leistungsanzeige" })).toBeVisible();
  // Counted over a frame's passes, each bound through the probe.
  expect(renderer.info.autoReset).toBe(false);
  expect(binds()).not.toBe(own);

  await screen.unmount();

  expect(renderer.info.autoReset).toBe(true);
  expect(binds()).toBe(own);

  // A frame draws as before, and the probe is told of none.
  opened.render();
  expect(renderer.info.render.frame).toBeGreaterThan(0);
  expect(probe.last).toBeUndefined();
});
