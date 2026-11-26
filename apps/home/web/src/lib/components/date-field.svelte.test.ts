import type { ComponentProps } from "svelte";
import { expect, test } from "vitest";
import { page, type Locator } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import "../../app.css";
import DateField from "../../../../../../packages/builder/src/components/date-field.svelte";
import { closed } from "../motion/animations.harness.ts";

const YEAR = new Date().getFullYear();

/** What `button` reads, its white space collapsed. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- vitest's own.
const text = (button: Locator) => button.element().textContent.trim().replaceAll(/\s+/gu, " ");

/** A field on `props` and every day it gives back. */
async function shown(props: Readonly<Partial<ComponentProps<typeof DateField>>>) {
  const picked: string[] = [];

  const screen = await render(DateField, {
    label: "Tag",
    value: "2026-11-13",
    onchange: (day: string) => {
      picked.push(day);
    },
    ...props,
  });

  return { picked, screen };
}

test("a compact field drops this year, names the whole day and steps years from a dropdown", async () => {
  const { screen, picked } = await shown({ variant: "compact", value: `${YEAR}-06-21` });
  const button = screen.getByRole("button", { name: `Tag: 21. Juni ${YEAR}` });

  await expect.poll(() => text(button)).toBe("21. Juni");

  await screen.rerender({ value: `${YEAR + 4}-06-21` });
  await expect
    .poll(() => text(screen.getByRole("button", { name: `Tag: 21. Juni ${YEAR + 4}` })))
    .toBe(`21. Juni ${String(YEAR + 4).slice(2)}`);

  await screen.getByRole("button", { name: /^Tag: /u }).click();

  const calendar = page.getByRole("application", { name: /^Tag /u });
  const years = calendar.getByLabelText("Select a year");

  // Twenty years back and ten ahead of today.
  await expect.element(years).toBeVisible();
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the DOM's own.
  expect([...years.element().querySelectorAll("option")].map((option) => option.value)).toEqual(
    Array.from({ length: 31 }, (_, i) => String(YEAR - 20 + i)),
  );

  await calendar.getByRole("button", { name: new RegExp(`, 10\\. Juni ${YEAR + 4}`, "u") }).click();

  expect(picked).toEqual([`${YEAR + 4}-06-10`]);
  await closed(calendar);
});

test("a shortcut picks its day, and rests while that day is picked", async () => {
  const shortcut = { text: "Heute", value: "2026-11-15" };
  const { screen, picked } = await shown({ variant: "compact", shortcut });

  await screen.getByRole("button", { name: /^Tag: /u }).click();
  await page.getByRole("button", { name: "Heute", exact: true }).click();

  expect(picked).toEqual(["2026-11-15"]);
  await closed(page.getByRole("grid"));

  await screen.rerender({ value: "2026-11-15" });
  await screen.getByRole("button", { name: /^Tag: /u }).click();
  await expect.element(page.getByRole("button", { name: "Heute", exact: true })).toBeDisabled();
});

test("a row shows its label, reads its empty shortcut while no day is picked and clears with it", async () => {
  const shortcut = { text: "Ab sofort", value: "" };
  const { screen, picked } = await shown({ variant: "row", label: "Gilt ab", value: "", shortcut });
  const row = screen.getByRole("button", { name: /^Gilt ab/u });

  await expect.poll(() => text(row)).toBe("Gilt ab Ab sofort");

  await row.click();
  await page.getByRole("button", { name: /, 13\. November 2026/u }).click();
  expect(picked).toEqual(["2026-11-13"]);

  await screen.rerender({ value: "2026-11-13" });
  await expect.poll(() => text(row)).toBe("Gilt ab 13.11.2026");

  await row.click();
  await page.getByRole("button", { name: "Ab sofort", exact: true }).click();
  expect(picked).toEqual(["2026-11-13", ""]);
});
