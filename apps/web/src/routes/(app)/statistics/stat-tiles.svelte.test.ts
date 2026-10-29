import { afterEach, describe, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import type { TileDef } from "$lib/statistics/tiles";
import StatTilesFixture from "./stat-tiles.fixture.svelte";

// The customize session reaches the saved preferences, which import the API
// client, which reads the server env at import. Nothing here fetches.
vi.mock("$lib/api", () => ({ api: {} }));

const tile = (id: string, value: string): TileDef<null> => ({
  id,
  label: () => `Tile ${id}`,
  explain: () => `What ${id} means`,
  compute: () => ({ value, sub: "since midnight", accent: "" }),
  raw: () => 1,
  goodDirection: "neutral",
});

// One very long total among short ones: the unbroken figure that used to widen
// its column and push the row off a phone.
const DEFS = [
  tile("a", "12.3 kWh"),
  tile("b", "1,234,567,890.12\u00a0kWh"),
  tile("c", "4.5 kWh"),
  tile("d", "0.0 kWh"),
  tile("e", "7.8 kWh"),
  tile("f", "9.9 kWh"),
];

const tiles = () => [...document.querySelectorAll("[data-slot=stat-tile]")];

afterEach(async () => {
  await page.viewport(1280, 800);
});

describe("statistics tiles on a 390px phone", () => {
  test("sit two to a row, not one", async () => {
    await page.viewport(390, 844);
    render(StatTilesFixture, { defs: DEFS });
    await expect.element(page.getByText("Tile f")).toBeVisible();

    const rows = new Set(tiles().map((t) => Math.round(t.getBoundingClientRect().top)));
    expect(rows.size).toBe(3);
  });

  test("a long total does not widen its column off the screen", async () => {
    await page.viewport(390, 844);
    render(StatTilesFixture, { defs: DEFS });
    await expect.element(page.getByText("Tile f")).toBeVisible();

    const widths = tiles().map((t) => Math.round(t.getBoundingClientRect().width));
    expect(new Set(widths).size).toBe(1);
    for (const t of tiles()) expect(t.getBoundingClientRect().right).toBeLessThanOrEqual(390);
  });

  test("a tile's label is at least 12px — it is the tile's only name", async () => {
    await page.viewport(390, 844);
    render(StatTilesFixture, { defs: DEFS });
    const label = page.getByText("Tile a").element();
    expect(Number.parseFloat(getComputedStyle(label).fontSize)).toBeGreaterThanOrEqual(12);
  });

  test("the explanation opens from a 44px target around a 14px icon", async () => {
    await page.viewport(390, 844);
    render(StatTilesFixture, { defs: DEFS });
    const trigger = page.getByRole("button", { name: /Tile a/ });
    const el = trigger.element();
    const box = el.getBoundingClientRect();
    const cx = box.left + box.width / 2;
    const cy = box.top + box.height / 2;
    // Vertically: the row above and below is the tile's own padding, so the
    // reach is measured where a thumb actually misses.
    for (const dy of [-18, 18]) {
      expect(el.contains(document.elementFromPoint(cx, cy + dy))).toBe(true);
    }
    await trigger.click();
    await expect.element(page.getByText("What a means")).toBeVisible();
  });
});

test("from lg up the same tiles run four to a row", async () => {
  render(StatTilesFixture, { defs: DEFS });
  await expect.element(page.getByText("Tile f")).toBeVisible();
  const rows = new Set(tiles().map((t) => Math.round(t.getBoundingClientRect().top)));
  expect(rows.size).toBe(2);
});
