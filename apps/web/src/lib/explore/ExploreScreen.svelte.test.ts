import { afterEach, expect, test, vi } from "vitest";
import { cdp, page, userEvent } from "vitest/browser";
// The screen is laid out by the SPA's utilities.
import "../../app.css";
import { plant, reset, show } from "./explore.harness.ts";
import { closed } from "../motion/animations.harness.ts";

afterEach(reset);

const desk = () => page.viewport(1280, 800);

test("opened with nothing chosen it shows the plant's PV power and house load for today", async () => {
  await desk();

  const { screen } = await show();
  const chosen = screen.getByRole("list", { name: "Gewählte Reihen" });

  await expect.element(screen.getByRole("heading", { name: "Erkunden", level: 1 })).toBeVisible();
  await expect.element(chosen.getByText("PV · Leistung")).toBeVisible();
  await expect.element(chosen.getByText("Haus · Leistung")).toBeVisible();
  await expect.element(screen.getByText("Heute")).toBeVisible();
  await expect.element(screen.getByRole("radio", { name: "Tag" })).toBeChecked();
  await expect.element(screen.getByRole("radio", { name: "Reihen" })).toBeChecked();
});

test("from 1024 px the picker is a pane beside the chart, listing devices and their series", async () => {
  await desk();

  const { screen } = await show();
  const picker = screen.getByRole("complementary", { name: "Reihen wählen" });

  await expect.element(picker.getByRole("heading", { name: "Anlage" })).toBeVisible();
  // A removed device with history left is marked.
  await expect
    .element(picker.getByRole("heading", { name: "Alter Speicher entfernt" }))
    .toBeVisible();
  // An estimate carries its mark.
  await expect
    .element(picker.getByRole("button", { name: /^≈ String 1 · Leistung/u }))
    .toBeVisible();
  await expect
    .element(picker.getByRole("button", { name: /^Eingang 2 · Leistung/u }))
    .toHaveAttribute("aria-pressed", "false");
  // What is charted is marked chosen.
  await expect
    .element(
      picker
        .getByRole("region", { name: "Anlage" })
        .getByRole("button", { name: /^Leistung/u })
        .first(),
    )
    .toHaveAttribute("aria-pressed", "true");
});

test("picking a series adds its chip and goes into the route as a step back can undo", async () => {
  await desk();

  const { screen, went } = await show("mode=overlay&vs=2026-11-14");

  await screen.getByRole("button", { name: /^Eingang 2 · Leistung/u }).click();

  await expect
    .element(
      screen.getByRole("list", { name: "Gewählte Reihen" }).getByText("PV · Eingang 2 · Leistung"),
    )
    .toBeVisible();
  await expect
    .poll(() => went.at(-1))
    .toMatchObject({
      push: true,
      patch: {
        s: "4294967294:pv.power,4294967294:load.power,1:pv.mppt.power[2]",
        mode: "overlay",
        vs: "2026-11-14",
      },
    });
});

test("the route's devices, series and mode come back as the view", async () => {
  await desk();

  const { screen } = await show("mode=fold&s=5:battery.soc&range=week");
  const chosen = screen.getByRole("list", { name: "Gewählte Reihen" });

  await expect.element(chosen.getByText("Batterie · Ladezustand")).toBeVisible();
  await expect.element(chosen.getByText(/Alter Speicher \(entfernt\)/u)).toBeVisible();
  expect(chosen.getByRole("listitem").elements()).toHaveLength(1);
  await expect.element(screen.getByRole("radio", { name: "Falten" })).toBeChecked();
  await expect.element(screen.getByRole("radio", { name: "Woche" })).toBeChecked();
  await expect.element(screen.getByRole("region", { name: "Falten" })).toBeVisible();
});

test("the mode switch changes the view and the route", async () => {
  await desk();

  const { screen, went } = await show();

  // The route follows once the switch has settled, on the test's clock.
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

  try {
    await screen.getByRole("radio", { name: "Überlagern" }).click();

    await expect.element(screen.getByRole("region", { name: "Überlagern" })).toBeVisible();
    await vi.runOnlyPendingTimersAsync();
    expect(went.at(-1)).toMatchObject({ push: true, patch: { mode: "overlay" } });
  } finally {
    vi.useRealTimers();
  }
});

test("a chip removes its series; with none left the screen says what to do", async () => {
  await desk();

  const { screen, went } = await show("s=5:battery.soc");

  await screen.getByRole("button", { name: "Batterie · Ladezustand entfernen" }).click();

  await expect.element(screen.getByText("Keine Reihe gewählt")).toBeVisible();
  await expect.poll(() => went.at(-1)?.patch).toMatchObject({ s: "" });
});

test("search filters by label and series id, and opens the Extras it finds in", async () => {
  await desk();

  const { screen } = await show();
  const picker = screen.getByRole("complementary", { name: "Reihen wählen" });

  // Extras stay folded until asked for.
  await expect.element(picker.getByRole("button", { name: "Extras" })).toBeVisible();
  expect(picker.getByRole("button", { name: /^fan/u }).query()).toBeNull();

  await picker.getByRole("searchbox", { name: "Reihen suchen" }).fill("extra.f");

  await expect.element(picker.getByRole("button", { name: /^fan/u })).toBeVisible();
  expect(picker.getByRole("heading", { name: "Anlage" }).query()).toBeNull();

  await picker.getByRole("searchbox", { name: "Reihen suchen" }).fill("nichts");

  await expect.element(picker.getByText("Keine Reihe passt zu „nichts“.")).toBeVisible();
});

test("without the catalog the chosen series keep their names and the picker offers to load again", async () => {
  await desk();
  plant.broken = true;

  const { screen } = await show();

  await expect
    .element(screen.getByRole("list", { name: "Gewählte Reihen" }).getByText("PV · Leistung"))
    .toBeVisible();
  await expect.element(screen.getByText("Die Reihen konnten nicht geladen werden.")).toBeVisible();

  plant.broken = false;
  await screen
    .getByRole("alert")
    .filter({ hasText: "Die Reihen konnten nicht geladen werden." })
    .getByRole("button", { name: "Erneut laden" })
    .click();

  await expect.element(screen.getByRole("heading", { name: "Deye" })).toBeVisible();
});

test("a chart that cannot be drawn without the catalog reads it again from its own retry", async () => {
  await desk();
  plant.broken = true;

  const { screen } = await show();

  const failed = screen
    .getByRole("alert")
    .filter({ hasText: "Ohne die Liste der Reihen lässt sich das Diagramm nicht zeichnen." });

  await expect.element(failed).toBeVisible();

  plant.broken = false;
  await failed.getByRole("button", { name: "Erneut laden" }).click();

  await expect.element(screen.getByRole("heading", { name: "Deye" })).toBeVisible();
  expect(failed.query()).toBeNull();
});

test("an unreachable core leaves the picker with the same way out", async () => {
  await desk();
  plant.offline = true;

  const { screen } = await show();

  await expect.element(screen.getByText("Die Reihen konnten nicht geladen werden.")).toBeVisible();
});

test("a route that opens the picker beside the pane still adds each series as a step", async () => {
  await desk();

  const { screen, went } = await show("pick=1");

  await screen.getByRole("button", { name: /^Eingang 2 · Leistung/u }).click();

  await expect.poll(() => went.at(-1)).toMatchObject({ push: true });
});

test("with a mouse below 1024 px the picker is a dialog", async () => {
  await page.viewport(900, 800);

  const { screen } = await show("pick=1");
  const dialog = page.getByRole("dialog", { name: "Reihen wählen" });

  expect(screen.getByRole("complementary", { name: "Reihen wählen" }).query()).toBeNull();
  await expect.element(dialog).toHaveAttribute("data-slot", "dialog-content");
  await expect
    .element(dialog.getByRole("button", { name: /^Eingang 2 · Leistung/u }))
    .toBeVisible();
});

test("a drawer closed without a pick goes back over its own step", async () => {
  await page.viewport(390, 844);

  const { screen, entries } = await show("s=5:battery.soc");

  await screen.getByRole("button", { name: "Reihe hinzufügen" }).click();

  const drawer = page.getByRole("dialog", { name: "Reihen wählen" });

  await expect.element(drawer).toBeVisible();
  await expect.poll(() => entries.length).toBe(2);

  await userEvent.keyboard("{Escape}");

  await closed(drawer);
  // One more back leaves Explore: no entry of the closed drawer is left behind.
  await expect.poll(() => entries.map(String)).toEqual(["s=5%3Abattery.soc"]);
});

// Last: touch emulation cannot be undone (pointer stays `none`).
test("under the bar the picker is a drawer: Add series opens it, a pick closes it", async () => {
  await page.viewport(390, 844);
  await cdp().send("Emulation.setTouchEmulationEnabled", { enabled: true });

  try {
    const { screen, went } = await show();

    expect(screen.getByRole("complementary", { name: "Reihen wählen" }).query()).toBeNull();

    await screen.getByRole("button", { name: "Reihe hinzufügen" }).click();

    const drawer = page.getByRole("dialog", { name: "Reihen wählen" });

    await expect.element(drawer).toHaveAttribute("data-slot", "drawer-content");
    // Opening is a step of its own, so back closes the drawer.
    await expect.poll(() => went.at(-1)).toMatchObject({ push: true, patch: { pick: "1" } });

    await drawer.getByRole("button", { name: /^Eingang 2 · Leistung/u }).click();

    await closed(drawer);
    await expect
      .element(
        screen
          .getByRole("list", { name: "Gewählte Reihen" })
          .getByText("PV · Eingang 2 · Leistung"),
      )
      .toBeVisible();
    await expect
      .poll(() => went.at(-1)?.patch)
      .toMatchObject({
        pick: null,
        s: "4294967294:pv.power,4294967294:load.power,1:pv.mppt.power[2]",
      });
  } finally {
    await cdp().send("Emulation.setTouchEmulationEnabled", { enabled: false });
  }
});

/** Where each part of the header stands. */
function header() {
  const box = (element: Element) => element.getBoundingClientRect();

  return {
    title: box(page.getByRole("heading", { name: "Erkunden", level: 1 }).element()),
    exported: box(page.getByRole("button", { name: "Als CSV exportieren" }).element()),
    full: box(page.getByRole("button", { name: "Vollbild" }).element()),
    // The range's row spans the header.
    row: box(page.getByRole("heading", { name: "Erkunden", level: 1 }).element().closest("header")!),
  };
}

test("on a phone below 415 px the title stands alone and its controls span the width under it", async () => {
  await page.viewport(390, 844);

  const { screen } = await show();

  await expect.element(screen.getByRole("heading", { name: "Erkunden", level: 1 })).toBeVisible();
  const { title, exported, full, row } = header();

  expect(exported.top).toBeGreaterThanOrEqual(title.bottom);
  expect(exported.left).toBe(row.left);
  expect(full.right).toBe(row.right);
  // The words stay.
  await expect.element(screen.getByText("Überlagern")).toBeVisible();
  expect(document.documentElement.scrollWidth).toBe(390);
});

test("from 415 px the title and its controls share one row", async () => {
  await page.viewport(430, 844);

  const { screen } = await show();

  await expect.element(screen.getByRole("heading", { name: "Erkunden", level: 1 })).toBeVisible();
  const { title, exported } = header();

  expect(exported.top).toBeLessThan(title.bottom);
  expect(exported.bottom).toBeGreaterThan(title.top);
});
