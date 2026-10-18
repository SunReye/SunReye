import { expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { periodWindow, type Grain, type Period } from "$lib/time/period";
import PeriodNavigator from "./period-navigator.svelte";

// The arithmetic (`$lib/time/period`) and the labels (`./period-navigator`) are
// unit-tested. What only the mounted control can say is which of its buttons a
// reader can press, what pressing one reports, and whether the row survives a
// phone. `e2e/period-navigator.spec.ts` drives the same control inside a page.

const ZONE = "Europe/Berlin";
const OPTS = { timeZone: ZONE, weekStartsOn: 7 as const };
const NOW = new Date("2026-08-19T10:00:00Z");
const at = (grain: Grain, instant: Date = NOW): Period => periodWindow(instant, grain, OPTS);

async function mount(period: Period, override: { id: string; label: string } | null = null) {
  const onPeriod = vi.fn<(p: Period) => void>();
  await render(PeriodNavigator, {
    period,
    override,
    now: NOW,
    timeZone: ZONE,
    onPeriod,
    onPreset: vi.fn(),
    onCustomRange: vi.fn(),
  });
  return onPeriod;
}

const grainRow = () => page.getByRole("group", { name: "Select time span" });

test("standing on today is live: the title says so and the forward arrow is dead", async () => {
  await mount(at("day"));

  const title = page.getByRole("button", { name: /Today/ });
  await expect.element(title).toBeVisible();
  expect(title.element().textContent).toContain("Live");
  await expect.element(page.getByRole("button", { name: "Next day" })).toBeDisabled();
  await expect.element(page.getByRole("button", { name: "Previous day" })).toBeEnabled();
});

test("a past day can step forward, and is not live", async () => {
  await mount(at("day", new Date("2026-08-02T10:00:00Z")));

  await expect.element(page.getByRole("button", { name: "Next day" })).toBeEnabled();
  const title = page.getByRole("button", { name: /Aug 2/ });
  await expect.element(title).toBeVisible();
  expect(title.element().textContent).not.toContain("Live");
});

test("the back arrow reports the previous period at the same grain", async () => {
  const onPeriod = await mount(at("month"));

  await page.getByRole("button", { name: "Previous month" }).click();

  expect(onPeriod).toHaveBeenCalledOnce();
  expect(onPeriod.mock.calls[0]![0]).toEqual(at("month", new Date("2026-07-15T10:00:00Z")));
});

test("forward out of a preset goes back to the live period, never past it", async () => {
  const onPeriod = await mount(at("day", new Date("2026-08-02T10:00:00Z")), {
    id: "6h",
    label: "6 hours",
  });

  await expect.element(page.getByRole("button", { name: /6 hours/ })).toBeVisible();
  await page.getByRole("button", { name: "Next day" }).click();

  expect(onPeriod.mock.calls[0]![0]).toEqual(at("day"));
});

test("a grain tab reports a period of that grain", async () => {
  const onPeriod = await mount(at("day"));

  await page.getByRole("button", { name: "Week", exact: true }).click();
  expect(onPeriod.mock.calls[0]![0]!.grain).toBe("week");
});

test("on a phone the four tabs share one line, each a thumb high", async () => {
  await mount(at("day"));

  const tabs = ["Day", "Week", "Month", "Year"].map((name) =>
    page.getByRole("button", { name, exact: true }).element().getBoundingClientRect(),
  );
  // One row, equal columns, inside the row's own box: a wrapping row puts the
  // fourth chip on a line of its own and reads as a separate control.
  expect(new Set(tabs.map((r) => Math.round(r.top))).size).toBe(1);
  const row = grainRow().element().getBoundingClientRect();
  for (const r of tabs) {
    expect(r.right).toBeLessThanOrEqual(row.right + 0.5);
    expect(r.height).toBeGreaterThanOrEqual(36);
  }
  expect(Math.round(tabs[0]!.width)).toBe(Math.round(tabs[3]!.width));
});
