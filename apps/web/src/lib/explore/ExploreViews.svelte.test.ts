import { afterEach, expect, test } from "vitest";
import { page } from "vitest/browser";
// The screen is laid out by the SPA's utilities.
import "../../app.css";
import { plant, reset, show } from "./explore.harness.ts";
import { chosenChips as chosen, FOLD, kept, savedChips as saved, WEEK } from "./views.harness.ts";

afterEach(reset);

const desk = () => page.viewport(1280, 800);

test("saved views stand as chips in the order saved; a tap opens one and marks its chip", async () => {
  await desk();
  kept.views = [WEEK, FOLD];

  const { screen, went } = await show("s=1:pv.power");
  const chips = saved().getByRole("button");

  await expect.element(chips.nth(0)).toHaveTextContent("Woche im Haus");
  await expect.element(chips.nth(1)).toHaveTextContent("Ertrag je Tag");
  await expect.element(chips.nth(0)).toHaveAttribute("aria-pressed", "false");

  await chips.nth(0).click();

  await expect.element(chips.nth(0)).toHaveAttribute("aria-pressed", "true");
  await expect.element(chips.nth(1)).toHaveAttribute("aria-pressed", "false");
  await expect.element(chosen().getByText("Haus · Leistung")).toBeVisible();
  await expect.element(screen.getByRole("radio", { name: "Woche" })).toBeChecked();
  // A step of its own: back returns to what was shown.
  await expect
    .poll(() => went.at(-1))
    .toMatchObject({
      push: true,
      patch: { range: "week", s: "4294967294:load.power", mode: null },
    });
});

test("opened with nothing chosen it opens the first saved view, in place", async () => {
  await desk();
  kept.views = [WEEK, FOLD];

  const { went } = await show();

  await expect.element(saved().getByRole("button").nth(0)).toHaveAttribute("aria-pressed", "true");
  await expect.element(chosen().getByText("Haus · Leistung")).toBeVisible();
  expect(chosen().getByText("PV · Leistung").query()).toBeNull();
  await expect.poll(() => went.at(-1)).toMatchObject({ push: false, patch: { range: "week" } });
  // The default was never read: the first view decided before the chart was built.
  expect(plant.asked.map((asked) => asked.series)).not.toContain("pv.power");
});

test("a route that names a view of its own is left alone, and marks no chip", async () => {
  await desk();
  kept.views = [WEEK];

  await show("s=1:pv.power");

  await expect.element(saved().getByRole("button")).toHaveAttribute("aria-pressed", "false");
  await expect.element(chosen().getByText("PV · Leistung")).toBeVisible();
});

test("the chips are left out of fullscreen", async () => {
  await desk();
  kept.views = [WEEK];
  Object.defineProperty(document, "fullscreenEnabled", { configurable: true, value: false });

  const { screen } = await show("s=1:pv.power");

  await expect.element(saved()).toBeVisible();
  await screen.getByRole("button", { name: "Vollbild", exact: true }).click();
  await expect.element(screen.getByRole("button", { name: "Vollbild beenden" })).toBeVisible();
  expect(saved().query()).toBeNull();

  Reflect.deleteProperty(document, "fullscreenEnabled");
});

test("a viewer sees the chips and the export, and no menu of actions", async () => {
  await desk();
  kept.views = [WEEK];

  const { screen } = await show("s=1:pv.power");

  await expect.element(saved().getByRole("button")).toBeVisible();
  await expect.element(screen.getByRole("button", { name: "Als CSV exportieren" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Weitere Aktionen" }).query()).toBeNull();
});

test("a series the catalog no longer lists is struck through and said to be gone; the rest draws", async () => {
  await desk();

  const { screen } = await show("s=1:pv.power,1:old.power");
  const gone = chosen().getByRole("listitem").nth(1);

  await expect.poll(() => gone.element().textContent).toContain("existiert nicht mehr");
  expect(getComputedStyle(gone.getByText(/old\.power/u).element()).textDecorationLine).toBe(
    "line-through",
  );

  const drawn = chosen().getByRole("listitem").nth(0).element();

  expect(drawn.textContent).not.toContain("existiert nicht mehr");
  expect(getComputedStyle(drawn.querySelector("span span")!).textDecorationLine).toBe("none");
  await expect.element(screen.getByRole("group", { name: /^Reihen über die Zeit/u })).toBeVisible();
  expect(plant.asked.map((asked) => asked.series)).toEqual(["pv.power"]);
});

test("until the catalog is read no series is said to be gone", async () => {
  await desk();
  plant.broken = true;

  const { screen } = await show("s=1:pv.power");

  await expect.element(screen.getByText("Die Reihen konnten nicht geladen werden.")).toBeVisible();
  expect(chosen().element().textContent).not.toContain("existiert nicht mehr");
});

test("twenty views stay one row that scrolls inside the card on a phone", async () => {
  await page.viewport(390, 844);
  kept.views = Array.from({ length: 20 }, (_, i) => ({
    id: i + 1,
    name: `Eine Ansicht mit langem Namen ${i + 1}`,
    query: `s=1:pv.power&at=2026-11-${String(i + 1).padStart(2, "0")}`,
  }));

  await show("s=1:pv.power");

  await expect.element(saved().getByRole("button").first()).toBeVisible();

  const row = saved().element();

  expect(row.getBoundingClientRect().height).toBeLessThanOrEqual(48);
  expect(row.scrollWidth).toBeGreaterThan(row.clientWidth);
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);
});

test("a view saved on today opens on today, from any range", async () => {
  await desk();
  kept.views = [{ id: 1, name: "Heute im Haus", query: "s=4294967294%3Aload.power" }];

  const { went } = await show("range=month&at=2026-10-15&s=1:pv.power");
  const chip = saved().getByRole("button", { name: "Heute im Haus" });

  await chip.click();

  await expect.element(chip).toHaveAttribute("aria-pressed", "true");
  await expect.element(page.getByRole("radio", { name: "Tag" })).toBeChecked();
  await expect.poll(() => went.at(-1)?.patch).toMatchObject({ at: null });

  // The house load was read for a day, never for the month the screen was on or the route's default.
  const days = plant.asked
    .filter((asked) => asked.series === "load.power")
    .map((asked) => (asked.to - asked.from) / 86_400_000);

  expect([...new Set(days)]).toEqual([1]);
});
