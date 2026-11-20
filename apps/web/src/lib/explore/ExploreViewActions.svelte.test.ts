import { afterEach, expect, test } from "vitest";
import { cdp, page, userEvent } from "vitest/browser";
// The screen is laid out by the SPA's utilities.
import "../../app.css";
import { reset, show } from "./explore.harness.ts";
import { chosenChips as chosen, FOLD, kept, savedChips as saved, WEEK } from "./views.harness.ts";

afterEach(reset);

const desk = () => page.viewport(1280, 800);

/** The admin's menu, opened. */
async function menu() {
  await page.getByRole("button", { name: "Weitere Aktionen" }).click();

  const items = page.getByRole("menuitem");

  await expect.element(items.first()).toBeVisible();

  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the DOM's own type.
  return items.elements().map((item) => item.textContent.trim());
}

test("the admin's menu holds the export and saves the route as a view named after its series", async () => {
  await desk();

  const { screen } = await show("range=week&at=2026-11-03", { admin: true });

  expect(screen.getByRole("button", { name: "Als CSV exportieren" }).query()).toBeNull();
  expect(await menu()).toEqual(["Als CSV exportieren", "Ansicht speichern"]);

  await page.getByRole("menuitem", { name: "Ansicht speichern" }).click();

  const name = page.getByRole("textbox", { name: "Name" });

  await expect.element(name).toHaveValue("PV · Leistung, Haus · Leistung");
  await name.fill("  Woche  ");
  await page.getByRole("button", { name: "Speichern" }).click();

  const chip = saved().getByRole("button", { name: "Woche" });

  await expect.element(chip).toHaveAttribute("aria-pressed", "true");
  expect(kept.views).toEqual([{ id: 1, name: "Woche", query: "at=2026-11-03&range=week" }]);
});

/** Opens the admin's menu and picks an action. */
async function pick(action: string) {
  await menu();
  await page.getByRole("menuitem", { name: action, exact: true }).click();
}

test("after changing an open view the menu updates it or saves the change as a new view", async () => {
  await desk();
  kept.views = [WEEK, FOLD];

  const { screen } = await show(WEEK.query, { admin: true });
  const chip = saved().getByRole("button", { name: "Woche im Haus" });

  await expect.element(chip).toHaveAttribute("aria-pressed", "true");
  expect(await menu()).toEqual(["Als CSV exportieren", "Umbenennen", "Löschen"]);
  await userEvent.keyboard("{Escape}");

  await screen.getByRole("radio", { name: "Monat" }).click();
  await expect.element(chip).toHaveAttribute("aria-pressed", "false");
  expect(await menu()).toEqual([
    "Als CSV exportieren",
    "Ansicht aktualisieren",
    "Als neue Ansicht speichern",
  ]);
  await expect.element(page.getByText("Geöffnet: Woche im Haus")).toBeVisible();

  await page.getByRole("menuitem", { name: "Ansicht aktualisieren" }).click();

  await expect.element(chip).toHaveAttribute("aria-pressed", "true");
  expect(kept.views).toEqual([{ ...WEEK, query: "range=month&s=4294967294%3Aload.power" }, FOLD]);
});

test("a taken name asks to replace that view, which keeps its place", async () => {
  await desk();
  kept.views = [WEEK, FOLD];

  await show("s=1:grid.voltage", { admin: true });

  await pick("Ansicht speichern");
  await page.getByRole("textbox", { name: "Name" }).fill("Woche im Haus");
  await page.getByRole("button", { name: "Speichern" }).click();

  await expect.element(page.getByText("„Woche im Haus“ ersetzen?")).toBeVisible();
  expect(kept.views).toEqual([WEEK, FOLD]);

  await page.getByRole("button", { name: "Ersetzen" }).click();

  await expect.element(saved().getByRole("button").nth(0)).toHaveAttribute("aria-pressed", "true");
  expect(kept.views).toEqual([{ ...WEEK, query: "s=1%3Agrid.voltage" }, FOLD]);
});

test("a full list says so and keeps the name for another try", async () => {
  await desk();
  kept.views = [WEEK];
  kept.most = 1;

  await show("s=1:pv.mppt.power[2]", { admin: true });

  await pick("Ansicht speichern");
  await page.getByRole("button", { name: "Speichern" }).click();

  await expect
    .element(
      page.getByText("20 Ansichten sind gespeichert. Lösche eine, um eine neue zu speichern."),
    )
    .toBeVisible();
  await expect
    .element(page.getByRole("textbox", { name: "Name" }))
    .toHaveValue("PV · Eingang 2 · Leistung");
  expect(kept.views).toEqual([WEEK]);
});

test("the marked view is renamed, and deleted once confirmed", async () => {
  await desk();
  kept.views = [WEEK, FOLD];

  await show(WEEK.query, { admin: true });

  await expect
    .element(saved().getByRole("button", { name: "Woche im Haus" }))
    .toHaveAttribute("aria-pressed", "true");
  await pick("Umbenennen");

  const name = page.getByRole("textbox", { name: "Name" });

  await expect.element(name).toHaveValue("Woche im Haus");
  // Another view's name is refused, not replaced.
  await name.fill("Ertrag je Tag");
  await page.getByRole("button", { name: "Speichern" }).click();
  await expect
    .element(page.getByText("Eine Ansicht mit diesem Namen existiert bereits."))
    .toBeVisible();
  await name.fill("Hauswoche");
  await page.getByRole("button", { name: "Speichern" }).click();

  const chip = saved().getByRole("button", { name: "Hauswoche" });

  await expect.element(chip).toHaveAttribute("aria-pressed", "true");
  expect(kept.views[0]).toEqual({ ...WEEK, name: "Hauswoche" });

  await pick("Löschen");
  await expect.element(page.getByText("„Hauswoche“ löschen?")).toBeVisible();
  expect(kept.views).toHaveLength(2);
  await page.getByRole("button", { name: "Löschen" }).click();

  await expect.element(chip).not.toBeInTheDocument();
  expect(kept.views).toEqual([FOLD]);
  // What it showed stays on screen, to be saved again.
  await expect.element(chosen().getByText("Haus · Leistung")).toBeVisible();
  expect(await menu()).toEqual(["Als CSV exportieren", "Ansicht speichern"]);
});

test("on a large phone the admin's menu stands in one row with the title, the mode switch and fullscreen", async () => {
  await page.viewport(430, 932);

  const { screen } = await show("", { admin: true });

  await expect.element(screen.getByRole("button", { name: "Weitere Aktionen" })).toBeVisible();

  const tops = [
    screen.getByRole("heading", { name: "Erkunden", level: 1 }),
    screen.getByRole("button", { name: "Weitere Aktionen" }),
    screen.getByRole("group", { name: "Ansicht" }),
    screen.getByRole("button", { name: "Vollbild", exact: true }),
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the browser's locator.
  ].map((locator) => {
    const box = locator.element().getBoundingClientRect();

    return box.top + box.height / 2;
  });

  expect(Math.max(...tops) - Math.min(...tops)).toBeLessThanOrEqual(8);
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(430);
});

// Last: touch emulation cannot be undone (pointer stays `none`).
test("under the bar the name is asked in a drawer, and the view is saved from it", async () => {
  await page.viewport(390, 844);
  await cdp().send("Emulation.setTouchEmulationEnabled", { enabled: true });

  try {
    await show("s=1:pv.mppt.power[2]", { admin: true });
    await pick("Ansicht speichern");

    const drawer = page.getByRole("dialog", { name: "Ansicht speichern" });

    await expect.element(drawer).toHaveAttribute("data-slot", "drawer-content");
    await expect
      .element(drawer.getByRole("textbox", { name: "Name" }))
      .toHaveValue("PV · Eingang 2 · Leistung");
    await drawer.getByRole("button", { name: "Speichern" }).click();

    await expect.element(drawer).not.toBeInTheDocument();
    await expect
      .element(saved().getByRole("button", { name: "PV · Eingang 2 · Leistung" }))
      .toHaveAttribute("aria-pressed", "true");
    expect(kept.views).toHaveLength(1);
  } finally {
    await cdp().send("Emulation.setTouchEmulationEnabled", { enabled: false });
  }
});
