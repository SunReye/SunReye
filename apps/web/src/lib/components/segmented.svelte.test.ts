import { afterEach, expect, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import "../../app.css";
import { haptics } from "../haptics.ts";
import SegmentedTabs from "./segmented-tabs.harness.svelte";
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

async function tabs(value = "day") {
  const selection = vi.spyOn(haptics, "selection");
  const chosen: string[] = [];

  const screen = await render(SegmentedTabs, {
    value,
    onchange: (next: string) => {
      chosen.push(next);
    },
  });

  return { screen, selection, chosen };
}

test("a tab the user picks switches the content, with one selection tick", async () => {
  const { screen, selection, chosen } = await tabs();

  await screen.getByRole("tab", { name: "Woche" }).click();

  expect(chosen).toEqual(["week"]);
  expect(selection).toHaveBeenCalledOnce();
  await expect.element(screen.getByText("Woche zeigt")).toBeVisible();
});

test("a tap on the open tab stays still", async () => {
  const { screen, selection, chosen } = await tabs();

  await screen.getByRole("tab", { name: "Tag" }).click();

  expect(chosen).toEqual([]);
  expect(selection).not.toHaveBeenCalled();
});

test("a tab opened from outside shows without a tick", async () => {
  const { screen, selection } = await tabs();

  await screen.rerender({ value: "week" });

  await expect.element(screen.getByText("Woche zeigt")).toBeVisible();
  expect(selection).not.toHaveBeenCalled();
});

/** What a segmented control and segmented tabs must share, of an element or its pseudo-element. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- a DOM element is mutable.
function looks(element: Element, pseudo?: string) {
  const style = getComputedStyle(element, pseudo);

  return {
    height: style.height,
    padding: style.padding,
    font: `${style.fontSize} ${style.fontWeight}`,
    radius: style.borderRadius,
    ring: style.boxShadow,
    background: style.backgroundColor,
    color: style.color,
    gap: style.gap,
  };
}

test.each(["light", "dark"])(
  "in the %s theme, segmented tabs look like the segmented control",
  async (theme) => {
    document.documentElement.classList.toggle("dark", theme === "dark");

    try {
      const { screen } = await tabs();

      const list = screen.getByRole("tablist", { name: "Tabs" }).element();
      const group = screen.getByRole("group", { name: "Segmente" }).element();

      // An earlier test's pointer may still rest on a tab and light its glow.
      await userEvent.unhover(list);
      // The pressed box is drawn once each has measured its chosen option.
      await expect.poll(() => Object.hasOwn(list.dataset, "indicator")).toBe(true);
      await expect.poll(() => Object.hasOwn(group.dataset, "indicator")).toBe(true);
      // The chosen option's own background fades out under the box.
      // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- an animation is mutable.
      await Promise.all(document.getAnimations().map((animation) => animation.finished));

      expect(looks(list)).toEqual(looks(group));
      expect(looks(list, "::before")).toEqual(looks(group, "::before"));

      for (const name of ["Tag", "Woche"])
        expect(looks(screen.getByRole("tab", { name }).element()), name).toEqual(
          looks(screen.getByRole("radio", { name }).element()),
        );
    } finally {
      document.documentElement.classList.remove("dark");
    }
  },
);
