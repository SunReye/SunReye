import { createRawSnippet } from "svelte";
import { afterEach, expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import PanelReadoutRow from "./panel-readout-row.svelte";

// The card's readout row: value left, controls right, and nothing at all when a
// card has neither. Most cards pass neither, so the empty case is the common one.

const html = (markup: string) => createRawSnippet(() => ({ render: () => markup }));

const slot = (container: HTMLElement, name: string) =>
  container.querySelector<HTMLElement>(`[data-slot="${name}"]`);

afterEach(async () => {
  await page.viewport(414, 896);
});

test("a card with neither a value nor controls spends no row on it", async () => {
  const { container } = await render(PanelReadoutRow, {});
  expect(slot(container, "panel-readout-row")).toBeNull();
});

test("either half on its own is enough to draw the row", async () => {
  const valueOnly = await render(PanelReadoutRow, {
    value: html("<span>4.2 kWh</span>"),
  });
  expect(slot(valueOnly.container, "panel-readout-row")).not.toBeNull();

  const controlsOnly = await render(PanelReadoutRow, {
    controls: html("<button>Day</button>"),
  });
  expect(slot(controlsOnly.container, "panel-readout-row")).not.toBeNull();
});

test("a long value shrinks instead of pushing the controls off the card", async () => {
  await page.viewport(1024, 768);
  const { container } = await render(PanelReadoutRow, {
    value: html(`<span style="white-space:nowrap">${"9".repeat(80)} kWh</span>`),
    controls: html("<button>Tagesansicht</button>"),
  });
  container.style.width = "400px";

  const row = slot(container, "panel-readout-row")!.getBoundingClientRect();
  const right = page
    .getByRole("button", { name: "Tagesansicht" })
    .element()
    .getBoundingClientRect().right;
  expect(right).toBeLessThanOrEqual(row.right + 0.5);
  // …and they hold the right edge rather than drifting toward the value.
  expect(right).toBeGreaterThan(row.right - 2);
});

test("on a phone the controls stack under the value, flush left", async () => {
  await page.viewport(390, 844);
  const { container } = await render(PanelReadoutRow, {
    value: html("<span>4.2 kWh</span>"),
    controls: html("<button>Day</button>"),
  });

  const value = slot(container, "panel-readout-value")!.getBoundingClientRect();
  const controls = page.getByRole("button", { name: "Day" }).element().getBoundingClientRect();
  expect(controls.top).toBeGreaterThanOrEqual(value.bottom);
  expect(Math.round(controls.left)).toBe(Math.round(value.left));
});
