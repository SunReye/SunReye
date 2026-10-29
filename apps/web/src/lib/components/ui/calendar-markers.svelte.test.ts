import { today, type CalendarDate } from "@internationalized/date";
import { afterEach, expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import { Calendar } from "./calendar";
import { RangeCalendar } from "./range-calendar";

// Today and a picked day must PAINT differently. When `app.css` had `--accent`
// equal to `--primary`, upstream shadcn's `bg-accent` today cell rendered exactly
// like a range endpoint and a one-day pick read as two days. Both day components
// are vendored and the palette is the designer's to change, so this asks the
// rendered cells, in both themes, rather than which token either side spells —
// a regenerate or a recolour that makes the two collide goes red here.
// `e2e/range-picker-selection.spec.ts` drives the same picker inside a page.

const ZONE = "Europe/Berlin";

afterEach(() => {
  document.documentElement.classList.remove("dark");
});

/** A day in today's month that is not today, so both markers are on screen. */
function otherDay(now: CalendarDate): CalendarDate {
  return now.day > 3 ? now.subtract({ days: 2 }) : now.add({ days: 2 });
}

/** A day of this month that is neither today nor picked. */
const plainDay = (container: HTMLElement) =>
  container.querySelector(
    "[data-bits-day]:not([data-selected]):not([data-today]):not([data-plant-today]):not([data-outside-month])",
  );

const paint = (cell: Element | null) => {
  if (!cell) throw new Error("cell not rendered");
  return getComputedStyle(cell).backgroundColor;
};

for (const theme of ["light", "dark"] as const) {
  test(`the range calendar paints today unlike a picked day (${theme})`, async () => {
    if (theme === "dark") document.documentElement.classList.add("dark");
    const now = today(ZONE);
    const picked = otherDay(now);
    const { container } = await render(RangeCalendar, {
      value: { start: picked, end: picked },
      placeholder: now,
      timeZone: ZONE,
    });

    const todayCell = container.querySelector("[data-bits-day][data-plant-today]");
    const endpoint = container.querySelector("[data-bits-day][data-range-start]");
    // A picked day nobody can see is the other way to make the two differ.
    expect(paint(endpoint)).not.toBe(paint(plainDay(container)));
    expect(paint(todayCell)).not.toBe(paint(endpoint));
  });

  test(`the single-date calendar paints today unlike the picked day (${theme})`, async () => {
    if (theme === "dark") document.documentElement.classList.add("dark");
    const now = today(ZONE);
    const picked = otherDay(now);
    const { container } = await render(Calendar, {
      type: "single",
      value: picked,
      placeholder: now,
    });

    const todayCell = container.querySelector("[data-bits-day][data-today]");
    const selected = container.querySelector("[data-bits-day][data-selected]");
    expect(paint(selected)).not.toBe(paint(plainDay(container)));
    expect(paint(todayCell)).not.toBe(paint(selected));
  });
}

test("the range calendar marks today in the range's zone, not the browser's", async () => {
  // UTC+14: for most of every day its date is not the browser's.
  const zone = "Pacific/Kiritimati";
  const now = today(zone);
  const { container } = await render(RangeCalendar, {
    placeholder: now,
    timeZone: zone,
  });

  const marked = container.querySelectorAll("[data-bits-day][data-plant-today]");
  expect(marked).toHaveLength(1);
  expect(marked[0]!.getAttribute("data-value")).toBe(now.toString());
});
