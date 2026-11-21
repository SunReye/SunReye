import { afterEach, beforeEach, expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import "../../app.css";
import { appears, fakeFrames, realTimers } from "../motion/clock.harness.ts";
import EvCard from "./EvCard.svelte";

// The figures count up on frames: the test's own.
beforeEach(fakeFrames);

afterEach(realTimers);

const card = (watts: number) =>
  render(EvCard, {
    device: 7,
    name: "Wallbox Garage",
    values: { "ev.charge.power": watts, "ev.vehicle.soc": 64, "ev.limit.soc": 80 },
    onopen: () => {},
  });

test("a charge below 1 kW reads in watts", async () => {
  const screen = await card(800);

  await appears(screen.getByText("800", { exact: true }));
  await expect.element(screen.getByText("W", { exact: true })).toBeVisible();
});

test("a charge from 1 kW reads in kilowatts", async () => {
  const screen = await card(3700);

  await appears(screen.getByText("3,7", { exact: true }));
  await expect.element(screen.getByText("kW", { exact: true })).toBeVisible();
});
