/**
 * The editor's two colour decisions: what it prefills from a saved chart, and
 * what it sends back.
 *
 * Both concern a colour record that can outlive the metric list it describes,
 * which is the sort of thing that goes wrong without anything looking wrong.
 */

import { describe, expect, test } from "bun:test";
import { chartFormInput, pinnedColors } from "./custom-chart-form";
import type { SeriesColor } from "./chart-palette";
import type { CustomChart } from "./custom-chart";

function chart(colors?: Record<string, string>): CustomChart {
  return {
    id: "a",
    name: "Strings",
    metrics: ["pv", "soc"],
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-01T00:00:00Z",
    ...(colors ? { colors } : {}),
  };
}

describe("pinnedColors", () => {
  test("takes the colours a saved chart carries", () => {
    expect(pinnedColors(chart({ pv: "chart-3" }))).toEqual({ pv: "chart-3" });
  });

  test("is empty for a chart that pinned none, and for a new chart", () => {
    expect(pinnedColors(chart())).toEqual({});
    expect(pinnedColors(null)).toEqual({});
  });

  test("drops an id the palette no longer names", () => {
    // A chart saved against an older palette, or a hand-edited blob. Carried
    // into the form it would be sent straight back and rejected on save — after
    // the user had already changed something else.
    expect(pinnedColors(chart({ pv: "chart-99", soc: "chart-2" }))).toEqual({ soc: "chart-2" });
  });

  test("drops a value that is not a palette id at all", () => {
    expect(pinnedColors(chart({ pv: "#ff0000" }))).toEqual({});
  });

  test("keeps a colour for a metric the chart does not draw", () => {
    // Not this function's call: the chart's own metric list is authoritative on
    // save, and dropping it here would silently discard the colour of a metric
    // the user is about to add back.
    expect(pinnedColors(chart({ gone: "chart-4" }))).toEqual({ gone: "chart-4" });
  });
});

describe("chartFormInput", () => {
  const colors = { pv: "chart-3", soc: "chart-5" } as Record<string, SeriesColor>;

  test("sends the trimmed name and the metrics in order", () => {
    expect(chartFormInput("  Strings  ", ["pv", "soc"], {})).toEqual({
      name: "Strings",
      metrics: ["pv", "soc"],
    });
  });

  test("omits colours entirely when nothing is pinned", () => {
    // So the ordinary chart persists no colour and keeps following the palette
    // if that ever changes.
    expect(chartFormInput("S", ["pv"], {})).not.toHaveProperty("colors");
  });

  test("sends the colours of the series it draws", () => {
    expect(chartFormInput("S", ["pv", "soc"], colors).colors).toEqual({
      pv: "chart-3",
      soc: "chart-5",
    });
  });

  test("prunes the colour of a metric that was taken off", () => {
    // Left in, it would come back the moment the metric was re-added — the
    // editor remembering something the user does not.
    expect(chartFormInput("S", ["pv"], colors).colors).toEqual({ pv: "chart-3" });
  });

  test("omits colours when every pinned metric was taken off", () => {
    expect(chartFormInput("S", ["other"], colors)).not.toHaveProperty("colors");
  });

  /**
   * The devices a saved chart names are NOT edited here — there is no device
   * picker — so the only thing this form can do to them is lose them.
   *
   * It read-modify-writes the whole chart, so a payload that omitted `devices`
   * would erase them on any unrelated edit: rename the chart, and the series
   * silently stops saying which inverter it was read from. That is unrecoverable
   * information — on a two-inverter plant nobody can say afterwards what it meant
   * — and it is the same class of bug the plant form's per-array overrides guard
   * against.
   */
  describe("the devices a chart names", () => {
    const devices = { pv: "east-inv", soc: "deye-1" };

    test("survive a save that touches nothing else", () => {
      expect(chartFormInput("S", ["pv", "soc"], {}, devices).devices).toEqual(devices);
    });

    test("are pruned with the metric they belonged to", () => {
      // Same rule as the colours, for the same reason: left in, the slug returns
      // the moment the metric is re-added — the editor remembering a choice the
      // user does not.
      expect(chartFormInput("S", ["pv"], {}, devices).devices).toEqual({ pv: "east-inv" });
    });

    test("are omitted entirely when none is left", () => {
      // Not `{}`: an empty map is a chart claiming to name devices, and the next
      // reader cannot tell it from one that named some and lost them.
      expect(chartFormInput("S", ["other"], {}, devices)).not.toHaveProperty("devices");
      expect(chartFormInput("S", ["pv"], {}, {})).not.toHaveProperty("devices");
      expect(chartFormInput("S", ["pv"], {})).not.toHaveProperty("devices");
    });

    test("are copied, not aliased, so a later edit cannot reach a payload in flight", () => {
      const live: Record<string, string> = { pv: "east-inv" };
      const input = chartFormInput("S", ["pv", "soc"], {}, live);
      live.soc = "deye-2";
      expect(input.devices).toEqual({ pv: "east-inv" });
    });
  });

  test("copies the metric list rather than aliasing the caller's", () => {
    // The editor's list is a live `SvelteSet` spread; handing the same array on
    // would let a later edit mutate a payload already in flight.
    const metrics = ["pv"];
    const input = chartFormInput("S", metrics, {});
    metrics.push("soc");
    expect(input.metrics).toEqual(["pv"]);
  });
});
