// Explore's charts take the chart entrance whenever the chart changes (ADR 21, #837).
import { afterEach, beforeEach, expect, test } from "vitest";
import { page } from "vitest/browser";
import "../../app.css";
import { PLANT } from "../api/computed-devices.ts";
import { built } from "../chart-entrance/built.harness.ts";
import { finish, holdEntrances } from "../motion/animations.harness.ts";
import { reset, show } from "./explore.harness.ts";

let release: () => void;

beforeEach(async () => {
  await page.viewport(1280, 800);
  release = holdEntrances();
});

afterEach(() => {
  release();
  reset();
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
