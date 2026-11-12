import { beforeEach, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import "../../app.css";
import { connect } from "../api/core.ts";
import Controls from "./Controls.svelte";
import { controlsCore } from "./controls.harness.ts";

beforeEach(async () => {
  await page.viewport(414, 896);
});

test("the time-of-use schedule is its own group, summarised by its slots' starts", async () => {
  const onnavigate = vi.fn();
  const screen = await render(Controls, { core: connect(controlsCore()), open: null, onnavigate });

  await screen.getByRole("button", { name: "Zeitplan 06:00 · 22:00" }).click();

  expect(onnavigate).toHaveBeenCalledWith("schedule");
});

test("the schedule's page shows each slot as a row of its values", async () => {
  const screen = await render(Controls, {
    core: connect(controlsCore()),
    open: "schedule",
    onnavigate: () => {},
  });

  const first = screen.getByRole("listitem").filter({ hasText: "Zeitfenster 1" });

  await expect.element(first.getByText("06:00–22:00")).toBeVisible();
  await expect.element(first.getByRole("button", { name: "Slot 1 start 06:00" })).toBeVisible();
  await expect.element(first.getByRole("button", { name: "Slot 1 power 3.000 W" })).toBeVisible();
  await expect.element(first.getByRole("button", { name: "Slot 1 SOC target 80 %" })).toBeVisible();
  await expect.element(first.getByRole("button", { name: "Slot 1 grid charge Off" })).toBeVisible();
  const second = screen.getByRole("listitem").filter({ hasText: "Zeitfenster 2" });

  await expect.element(second.getByText("22:00–06:00")).toBeVisible();
});

test("applying a slot's start writes minutes since midnight through the funnel", async () => {
  const transport = controlsCore();

  const screen = await render(Controls, {
    core: connect(transport),
    open: "schedule",
    onnavigate: () => {},
  });

  await screen.getByRole("button", { name: "Slot 1 start 06:00" }).click();

  page.getByRole("spinbutton", { name: "Stunde" }).element().focus();
  await userEvent.keyboard("{ArrowUp}");
  await userEvent.click(page.getByRole("button", { name: /^Übernehmen/u }));

  expect(transport.writes).toEqual([
    'PUT /api/v1/devices/3/settings/battery.time_of_use.1.start {"value":420}',
  ]);
  await expect.element(screen.getByRole("button", { name: "Slot 1 start 07:00" })).toBeVisible();
});
