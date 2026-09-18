/**
 * Do the statistics charts' axis labels FIT the box they are drawn in?
 *
 * Two failures were reported from a phone: labels cut off at the edge of the
 * plot, and labels running into each other. Neither is visible to the unit
 * suite and neither is visible to a DOM assertion either — these charts render
 * on CANVAS (`layerchart/canvas`, the >24-band INP freeze), so a tick label is
 * not an element with a bounding box. It is a `fillText` call.
 *
 * So that is what is measured: `CanvasRenderingContext2D.fillText` is wrapped
 * before the app boots, and every call is recorded as a real box — the text's
 * own `measureText` width, positioned by the context's `textAlign` and mapped
 * out of layerchart's plot-space transform into the canvas element's own CSS
 * pixels. Two claims follow from those boxes and nothing else:
 *
 *  - every label is inside its canvas (nothing is CUT OFF);
 *  - no two labels sharing a baseline touch (nothing OVERLAPS).
 *
 * Measured at two phone widths and one laptop width. The laptop pass is not a
 * formality: the fix hands the y-axis the room its widest label needs, and a
 * gutter that only ever grows would eat a desktop plot.
 *
 * What this cannot see: a chart that is not on the page in the fixture backend
 * (the battery-health trend needs measured capacities). Its axis policy is the
 * same one, unit-tested in `src/lib/components/statistics/axis-fit.test.ts`.
 */

import { expect, test, type Page } from "@playwright/test";
import { openPage } from "./support/open-page";

/** The two phones the dashboard is read on, and the laptop it is built on. */
const PHONE_SMALL = { width: 360, height: 800 };
const PHONE = { width: 412, height: 915 };
const LAPTOP = { width: 1024, height: 768 };

/** A label may sit flush against the edge, but not a pixel past it. */
const EDGE_SLACK_PX = 0.5;

/** Two labels on one baseline need daylight between them to read as two. */
const MIN_LABEL_GAP_PX = 2;

interface DrawnLabel {
  text: string;
  /** Box in the canvas ELEMENT's CSS pixels — plot transform already undone. */
  left: number;
  right: number;
  y: number;
  canvas: number;
  canvasWidth: number;
  panel: string;
  /** Is this one of the statistics charts, rather than a chart this page
   *  merely hosts? Set by `data-slot=statistics-plot` on the chart's own box. */
  statistics: boolean;
}

declare global {
  interface Window {
    __drawnLabels?: DrawnLabel[];
  }
}

/**
 * Wrap `fillText` before the app loads, so every axis tick a canvas chart draws
 * is recorded with the geometry the renderer actually used.
 */
async function recordCanvasText(page: Page) {
  await page.addInitScript(() => {
    const drawn: DrawnLabel[] = [];
    window.__drawnLabels = drawn;
    let nextId = 0;
    const proto = CanvasRenderingContext2D.prototype;
    const fillText = proto.fillText;
    proto.fillText = function (this: CanvasRenderingContext2D, text, x, y, maxWidth?) {
      try {
        const canvas = this.canvas as HTMLCanvasElement & { __id?: number };
        canvas.__id ??= ++nextId;
        const label = String(text);
        const width = this.measureText(label).width;
        const align = this.textAlign;
        const plotLeft = align === "center" ? x - width / 2 : align === "right" ? x - width : x;
        // layerchart draws in PLOT space: the context carries the padding
        // translate and the device-pixel-ratio scale. Undo both, so the numbers
        // below are the canvas element's own CSS pixels.
        const t = this.getTransform();
        const scale = canvas.width / canvas.clientWidth;
        drawn.push({
          text: label,
          left: (plotLeft * t.a + t.e) / scale,
          right: ((plotLeft + width) * t.a + t.e) / scale,
          y: (y * t.d + t.f) / scale,
          canvas: canvas.__id,
          canvasWidth: canvas.clientWidth,
          panel: canvas.closest("section")?.querySelector("h2")?.textContent?.trim() ?? "?",
          statistics: canvas.closest("[data-slot=statistics-plot]") !== null,
        });
      } catch {
        // A probe must never be the reason a chart fails to draw.
      }
      return maxWidth === undefined
        ? fillText.call(this, text, x, y)
        : fillText.call(this, text, x, y, maxWidth);
    };
  });
}

/**
 * The labels currently on screen: charts redraw on every hover and resize, so
 * the same text is recorded many times. One entry per (canvas, text, place).
 */
async function labelsOn(page: Page): Promise<DrawnLabel[]> {
  // A dev-server full reload (Vite's dep optimizer, the reason `global-setup`
  // pre-bundles) tears the execution context down mid-poll. That is the harness
  // reloading, not the page failing: the probe is reinstalled by the init script
  // and the next poll reads the redrawn labels.
  const drawn = await page
    .evaluate(() => window.__drawnLabels ?? [])
    .catch(() => [] as DrawnLabel[]);
  const latest = new Map<string, DrawnLabel>();
  for (const label of drawn) {
    latest.set(
      `${label.canvas}|${label.text}|${Math.round(label.left)}|${Math.round(label.y)}`,
      label,
    );
  }
  // Every plot ON THIS PAGE, which includes the `Today`/`Tomorrow` price curves
  // (`prices/price-track-chart.svelte`). They were once excluded as "another
  // component, another owner" on the belief that they were the dashboard's
  // `inverter/forecast-chart.svelte`. They are not — that one is only ever
  // mounted in the solar-forecast dialog and its labels are `HH:mm`, while
  // these draw an 11-character `MM-DD HH:mm` at the day boundary
  // (`prices/price-series.ts`) and are the widest x labels on the page. A
  // filter that hides the worst case from the spec written to catch it is the
  // one thing this file must not do.
  return [...latest.values()].filter((label) => label.statistics);
}

/** Open /statistics with the viewport set BEFORE the first layout. */
async function openStatistics(page: Page, viewport: { width: number; height: number }) {
  await recordCanvasText(page);
  await page.setViewportSize(viewport);
  await openPage(page, "/#/statistics");
  // The panels below the fold mount on scroll; every chart on the page counts.
  await page.mouse.wheel(0, 4000);
  await expect
    .poll(async () => (await labelsOn(page)).length, { timeout: 20_000 })
    .toBeGreaterThan(20);
  return labelsOn(page);
}

/** `label`, named the way a failure message should name it. */
function name(label: DrawnLabel): string {
  return `"${label.text}" in ${label.panel} (canvas ${label.canvas}, ${label.canvasWidth}px)`;
}

for (const viewport of [PHONE_SMALL, PHONE, LAPTOP]) {
  test(`no statistics axis label is cut off at ${viewport.width}px`, async ({ page }) => {
    const labels = await openStatistics(page, viewport);

    const clipped = labels
      .filter((l) => l.left < -EDGE_SLACK_PX || l.right > l.canvasWidth + EDGE_SLACK_PX)
      .map((l) => `${name(l)}: ${l.left.toFixed(1)}…${l.right.toFixed(1)}`);
    expect(clipped).toEqual([]);
  });

  test(`no two statistics axis labels overlap at ${viewport.width}px`, async ({ page }) => {
    const labels = await openStatistics(page, viewport);

    // One baseline at a time: a y-axis tick and an x-axis tick may share a
    // column without being the same row of text.
    const rows = new Map<string, DrawnLabel[]>();
    for (const label of labels) {
      const key = `${label.canvas}|${Math.round(label.y)}`;
      rows.set(key, [...(rows.get(key) ?? []), label]);
    }

    const collisions: string[] = [];
    for (const row of rows.values()) {
      const ordered = [...row].sort((a, b) => a.left - b.left);
      for (let i = 1; i < ordered.length; i++) {
        const gap = ordered[i].left - ordered[i - 1].right;
        if (gap < MIN_LABEL_GAP_PX) {
          collisions.push(`${name(ordered[i - 1])} → ${name(ordered[i])}: ${gap.toFixed(1)}px`);
        }
      }
    }
    expect(collisions).toEqual([]);
  });
}
