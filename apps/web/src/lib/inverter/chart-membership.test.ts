/**
 * "Add this metric to a chart" — which charts a metric is already on, which
 * ones still have room, and what a toggle does to a chart's metric list.
 *
 * The affordance is a menu on every card on /history, so the answers have to
 * hold for a metric on no chart, on several, and on one that is already at the
 * overlay limit. All of it is plain data here; the menu component only renders
 * what this returns and calls the store.
 */

import { describe, expect, test } from "bun:test";
import { MAX_CHART_METRICS, type CustomChart } from "./custom-chart";
import { membership, plannedUpdate } from "./chart-membership";

function chart(id: string, name: string, metrics: string[]): CustomChart {
  return {
    id,
    name,
    metrics,
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-01T00:00:00Z",
  };
}

const PV = "dc.pv1.power";
const LOAD = "ac.load.power";

describe("membership", () => {
  test("says which charts already hold the metric", () => {
    const charts = [chart("a", "Strings", [PV]), chart("b", "House", [LOAD])];
    expect(membership(charts, PV)).toEqual([
      { id: "a", name: "Strings", holds: true, full: false },
      { id: "b", name: "House", holds: false, full: false },
    ]);
  });

  test("keeps the store's order, which is newest first", () => {
    // The menu is a list of the user's own charts; re-sorting it here would
    // make the same chart move between the editor's list and this one.
    const charts = [chart("a", "Zebra", []), chart("b", "Alpha", [])];
    expect(membership(charts, PV).map((item) => item.id)).toEqual(["a", "b"]);
  });

  test("marks a chart that is at the overlay limit as full", () => {
    const packed = Array.from({ length: MAX_CHART_METRICS }, (_, i) => `m${i}`);
    expect(membership([chart("a", "Packed", packed)], PV)[0]).toEqual({
      id: "a",
      name: "Packed",
      holds: false,
      full: true,
    });
  });

  test("a full chart that already holds the metric is not full for THIS metric", () => {
    // Removing is always allowed; showing the row as full would disable the
    // only way back off a chart that is at its limit.
    const packed = [PV, ...Array.from({ length: MAX_CHART_METRICS - 1 }, (_, i) => `m${i}`)];
    expect(membership([chart("a", "Packed", packed)], PV)[0]).toEqual({
      id: "a",
      name: "Packed",
      holds: true,
      full: false,
    });
  });

  test("is empty when there are no charts yet", () => {
    expect(membership([], PV)).toEqual([]);
  });
});

describe("what a pick does to the metric list", () => {
  // Through `plannedUpdate`, which is the module's whole surface — the toggle
  // itself is module-private so a caller cannot reach past the cases below.
  const only = (metrics: string[]) => [chart("a", "S", metrics)];

  test("appends the metric to a chart that does not hold it", () => {
    expect(plannedUpdate(only([LOAD]), "a", PV)?.input.metrics).toEqual([LOAD, PV]);
  });

  test("appends rather than prepends, so the series colours do not shuffle", () => {
    // Colour is assigned by position, so putting a new metric first would
    // recolour every series already on the chart.
    expect(plannedUpdate(only(["x", "y"]), "a", PV)?.input.metrics).toEqual(["x", "y", PV]);
  });

  test("removes the metric from a chart that holds it", () => {
    expect(plannedUpdate(only([LOAD, PV]), "a", PV)?.input.metrics).toEqual([LOAD]);
  });

  test("removes every copy, not only the first", () => {
    // The list is stored as the client sends it; a duplicate left behind would
    // keep the row reading as "on" after a toggle.
    expect(plannedUpdate(only([PV, LOAD, PV]), "a", PV)?.input.metrics).toEqual([LOAD]);
  });

  test("still removes from a chart that is at the limit", () => {
    const packed = [PV, ...Array.from({ length: MAX_CHART_METRICS - 1 }, (_, i) => `m${i}`)];
    expect(plannedUpdate(only(packed), "a", PV)?.input.metrics).toHaveLength(MAX_CHART_METRICS - 1);
  });
});

describe("plannedUpdate", () => {
  const charts = [chart("a", "Strings", [LOAD]), chart("b", "House", [PV, LOAD])];

  test("sends the chart's own name back with the new metric list", () => {
    // The update endpoint takes the whole record; dropping the name would
    // rename the chart to nothing every time a metric is toggled.
    expect(plannedUpdate(charts, "a", PV)).toEqual({
      id: "a",
      input: { name: "Strings", metrics: [LOAD, PV] },
    });
  });

  test("takes the metric back off a chart that holds it", () => {
    expect(plannedUpdate(charts, "b", PV)?.input.metrics).toEqual([LOAD]);
  });

  test("sends nothing for a chart that is no longer there", () => {
    // Another tab deleted it between render and click.
    expect(plannedUpdate(charts, "gone", PV)).toBe(null);
  });

  test("sends nothing when adding would pass the overlay limit", () => {
    const packed = [
      chart(
        "c",
        "Packed",
        Array.from({ length: MAX_CHART_METRICS }, (_, i) => `m${i}`),
      ),
    ];
    expect(plannedUpdate(packed, "c", PV)).toBe(null);
  });

  test("sends nothing when the toggle would empty the chart", () => {
    // The server rejects a chart with no metrics, and quietly deleting the
    // user's chart because they took its last series off is a worse answer
    // than leaving it alone.
    expect(plannedUpdate([chart("d", "Only", [PV])], "d", PV)).toBe(null);
  });
});

/**
 * The wiring the data tests above cannot see. Read as source text — a `.svelte`
 * file cannot be exercised under `bun test`; see apps/web/TESTING.md.
 */
const WEB = new URL("../../", import.meta.url);
const read = async (file: string): Promise<string> => await Bun.file(new URL(file, WEB)).text();

describe("the request to open the editor is consumed, not just read", () => {
  test("the section clears the seed as it opens the dialog", async () => {
    // `editorSeed` is state, and the effect that opens the editor depends on
    // it. Left set, the effect re-runs and forces the dialog open again the
    // moment the user closes it — with no way out of the page.
    const section = await read("lib/components/inverter/custom-chart-section.svelte");
    const effect = section.slice(section.indexOf("customCharts.editorSeed"));
    const clear = effect.indexOf("customCharts.editorSeed = null");
    const open = effect.indexOf("editorOpen = true");
    expect(clear).toBeGreaterThan(-1);
    expect(open).toBeGreaterThan(-1);
    expect(clear).toBeLessThan(open);
  });

  test("the menu asks through the store rather than through six props", async () => {
    // The editor dialog is mounted once, by the section; the card that offers
    // "new chart with this metric" is two components below it and shares no
    // ancestor that holds the dialog's state.
    const menu = await read("lib/components/inverter/_shared/metric-chart-menu.svelte");
    expect(menu).toContain("customCharts.seedEditor([metricKey])");
  });

  test("the editor starts a NEW chart from the seed, and never an edited one", async () => {
    // Prefilling an existing chart's picker from the seed would silently add a
    // metric to a chart the user only opened to rename.
    const editor = await read("lib/components/inverter/custom-chart-editor.svelte");
    expect(editor).toMatch(
      /draftOf\s*=\s*\(c: CustomChart \| null\) => c \?\? \{[^}]*metrics: seed/,
    );
  });
});

describe("the menu is offered to the people who can use it", () => {
  test("only an admin sees it — saving a chart is an admin write", async () => {
    const cluster = await read("lib/components/inverter/_shared/metric-card-actions.svelte");
    expect(cluster).toMatch(/\{#if canEditCharts\}\s*<MetricChartMenu/);
    expect(cluster).toContain("$session.data?.user.role === 'admin'");
  });
});
