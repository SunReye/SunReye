// Explore's charts take the chart entrance whenever the chart changes (ADR 21, #837).
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import "../../app.css";
import { PLANT } from "../api/computed-devices.ts";
import { built, leaving } from "../chart-entrance/built.harness.ts";
import { finish, hold, holdEntrances } from "../motion/animations.harness.ts";
import { reset, show } from "./explore.harness.ts";

let release: () => void;

beforeEach(async () => {
  await page.viewport(1280, 800);
  release = holdEntrances();
});

afterEach(() => {
  release();
  vi.restoreAllMocks();
  vi.useRealTimers();
  reset();
  delete document.documentElement.dataset["motion"];
});

/** What builds in the chart of mode `name`: the picker's scroll fade is no chart's. */
const builds = (name: string) =>
  built()
    .filter(
      (b) => document.querySelector(`section[aria-label="${name}"]`)?.contains(b.target) === true,
    )
    .map((b) => b.build);

/** The lanes' names, each with the series it draws. */
const lanes = () =>
  [...document.querySelectorAll("[role=img][aria-label^=Bahn]")].map((l) =>
    l.getAttribute("aria-label"),
  );

/** The canvases in the chart of series mode: one per drawing, the one before while it leaves. */
const drawings = () => document.querySelectorAll('section[aria-label="Reihen"] canvas').length;

/** The screen at `query`, its first entrance played out. */
async function shown(query = "", mode = "Reihen") {
  const { screen } = await show(query);

  await expect.poll(() => builds(mode)).toContain("draw");
  await finish();
  await expect.poll(() => builds(mode)).toEqual([]);

  return screen;
}

test("a series added to a lane already drawn builds in", async () => {
  const screen = await shown();

  await screen.getByRole("button", { name: /^Eingang 2 · Leistung/u }).click();

  await expect.poll(lanes).toEqual([expect.stringContaining("Eingang 2")]);
  await expect.poll(() => builds("Reihen")).toContain("draw");
});

test("a series the overlay does not draw leaves its chart in place", async () => {
  const screen = await shown(`mode=overlay&s=${PLANT}:pv.power`, "Überlagern");

  await screen.getByRole("button", { name: /^Ladezustand/u }).click();

  await expect.element(screen.getByText(/^Überlagert wird PV · Leistung/u)).toBeVisible();
  expect(builds("Überlagern")).toEqual([]);
});

test("a series removed fades out with its lane as the chart builds in without it", async () => {
  const screen = await shown(`s=${PLANT}:pv.power,5:battery.soc`);

  hold();
  await screen.getByRole("button", { name: "Batterie · Ladezustand entfernen" }).click();

  await expect.poll(lanes).toEqual([expect.stringContaining("PV · Leistung")]);
  expect(drawings()).toBe(2);
  // The drawing before, with the lane removed, fades out.
  expect(leaving().filter((el) => el.querySelector("canvas") !== null)).toHaveLength(1);
  await expect.poll(() => builds("Reihen")).toContain("draw");

  await finish();

  expect(drawings()).toBe(1);
});

test("another mode builds its chart in", async () => {
  const screen = await shown();

  // The route follows once the switch has settled, on the test's clock.
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  await screen.getByRole("radio", { name: "Falten" }).click();

  await expect.poll(() => builds("Falten")).toContain("draw");
  await vi.runOnlyPendingTimersAsync();
});

test("on the still tier a series added or removed is drawn at once", async () => {
  document.documentElement.dataset["motion"] = "still";
  const { screen } = await show(`s=${PLANT}:pv.power`);

  await expect.poll(drawings).toBe(1);
  await screen.getByRole("button", { name: /^Ladezustand/u }).click();
  await expect.poll(lanes).toHaveLength(2);

  expect(drawings()).toBe(1);
  expect(builds("Reihen")).toEqual([]);

  await screen.getByRole("button", { name: "Batterie · Ladezustand entfernen" }).click();
  await expect.poll(lanes).toHaveLength(1);

  expect(drawings()).toBe(1);
  expect(builds("Reihen")).toEqual([]);
});
