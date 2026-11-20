import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import "../../app.css";
import { connect } from "../api/core.ts";
import { haptics } from "../haptics.ts";
import { problem } from "../settings/settings.harness.ts";
import Controls from "./Controls.svelte";
import { SCHEDULE, controlsCore } from "./controls.harness.ts";

beforeEach(async () => {
  await page.viewport(414, 896);
});

afterEach(() => {
  vi.restoreAllMocks();
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

test("a switch above the slots turns the schedule on through the funnel", async () => {
  const selection = vi.spyOn(haptics, "selection");
  const success = vi.spyOn(haptics, "success");
  const transport = controlsCore();

  const screen = await render(Controls, {
    core: connect(transport),
    open: "schedule",
    onnavigate: () => {},
  });

  const on = screen.getByRole("checkbox", { name: "Zeitplan aktiv" });

  await expect.element(on).not.toBeChecked();
  await on.click();

  await expect.element(on).toBeChecked();
  expect(transport.writes).toEqual([`PUT /api/v1/devices/3/settings/${SCHEDULE} {"value":1}`]);
  expect(screen.getByRole("listitem").elements()).toHaveLength(2);
  // The tap ticks; the read-back confirms. The value it reads back is no second tick.
  await vi.waitFor(() => {
    expect(success).toHaveBeenCalledOnce();
  });
  expect(selection).toHaveBeenCalledOnce();
});

test("the schedule switch waits for the admin's enable like any setting", async () => {
  const transport = controlsCore({ scheduleEnable: "off" });

  const screen = await render(Controls, {
    core: connect(transport),
    open: "schedule",
    onnavigate: () => {},
  });

  await expect.element(screen.getByRole("checkbox", { name: "Zeitplan aktiv" })).toBeDisabled();
  await expect
    .element(screen.getByText("Braucht deine Freigabe unter Einstellungen › Schreiben"))
    .toBeVisible();
});

test("a refused switch stays where the device is and says why", async () => {
  const screen = await render(Controls, {
    core: connect(controlsCore({ refuse: () => problem(429, "setting.interval") })),
    open: "schedule",
    onnavigate: () => {},
  });

  const on = screen.getByRole("checkbox", { name: "Zeitplan aktiv" });

  await on.click();

  await expect.element(screen.getByRole("alert").getByText("Abgelehnt.")).toBeVisible();
  await expect.element(on).not.toBeChecked();
});
