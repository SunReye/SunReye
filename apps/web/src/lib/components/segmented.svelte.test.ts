import { afterEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import "../../app.css";
import { haptics } from "../haptics.ts";
import Segmented from "./segmented.svelte";

afterEach(() => {
  vi.restoreAllMocks();
});

const OPTIONS = [
  ["day", "Tag"],
  ["week", "Woche"],
  ["month", "Monat"],
] as const;

async function segmented(value: "day" | "week" | "month" = "day") {
  const selection = vi.spyOn(haptics, "selection");
  const chosen: string[] = [];

  const screen = await render(Segmented, {
    options: OPTIONS,
    value,
    label: "Zeitraum",
    onchange: (next: string) => {
      chosen.push(next);
    },
  });

  return { screen, selection, chosen };
}

test("a choice the user makes is passed on, with one selection tick", async () => {
  const { screen, selection, chosen } = await segmented();

  await screen.getByRole("radio", { name: "Woche" }).click();

  expect(chosen).toEqual(["week"]);
  expect(selection).toHaveBeenCalledOnce();
});

test("a tap on the chosen option changes nothing and stays still", async () => {
  const { screen, selection, chosen } = await segmented();

  await screen.getByRole("radio", { name: "Tag" }).click();

  expect(chosen).toEqual([]);
  expect(selection).not.toHaveBeenCalled();
  await expect
    .element(screen.getByRole("radio", { name: "Tag" }))
    .toHaveAttribute("data-state", "on");
});

test("a value set from outside shows without a tick", async () => {
  const { screen, selection, chosen } = await segmented();

  await screen.rerender({ value: "month" });

  await expect
    .element(screen.getByRole("radio", { name: "Monat" }))
    .toHaveAttribute("data-state", "on");
  expect(chosen).toEqual([]);
  expect(selection).not.toHaveBeenCalled();
});

test("its group carries the name", async () => {
  const { screen } = await segmented();

  await expect.element(screen.getByRole("group", { name: "Zeitraum" })).toBeVisible();
});
