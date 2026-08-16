/**
 * A draft overlay: the metrics a reader is trying out on one full-screened
 * card, that no server has ever seen.
 *
 * The base metric — the card's own — is not part of the draft. It is what the
 * card was already showing, it is always first (so it keeps chart accent 1 when
 * others come and go), and it cannot be taken off. Everything here is about the
 * metrics added ON TOP of it.
 */

import { describe, expect, test } from "bun:test";
import { MAX_CHART_METRICS } from "./custom-chart";
import { draftMetrics, isDrafted, toggleDraft } from "./chart-draft";

const BASE = "ac.load.power";
const PV = "dc.pv1.power";
const SOC = "battery.soc";

describe("draftMetrics", () => {
  test("puts the card's own metric first", () => {
    // Position decides colour. The base keeps accent 1 however the draft
    // changes around it, so the line the reader started from does not change
    // colour under them as they add and remove others.
    expect(draftMetrics(BASE, [PV, SOC])).toEqual([BASE, PV, SOC]);
  });

  test("is just the base metric when nothing has been added", () => {
    // The card is showing one metric — the same list it would show anyway.
    expect(draftMetrics(BASE, [])).toEqual([BASE]);
  });

  test("keeps the order metrics were added in", () => {
    expect(draftMetrics(BASE, [SOC, PV])).toEqual([BASE, SOC, PV]);
  });

  test("never repeats the base, even if it is somehow in the draft", () => {
    // `toggleDraft` refuses to add it, but the list also reaches here from a
    // seeded editor round-trip, and a duplicated key would draw the same series
    // twice in two colours.
    expect(draftMetrics(BASE, [PV, BASE])).toEqual([BASE, PV]);
  });
});

describe("toggleDraft", () => {
  test("adds a metric that is not in the draft", () => {
    expect(toggleDraft(BASE, [], PV)).toEqual([PV]);
  });

  test("appends, so the colours already on the chart do not shuffle", () => {
    expect(toggleDraft(BASE, [PV], SOC)).toEqual([PV, SOC]);
  });

  test("removes one that is", () => {
    expect(toggleDraft(BASE, [PV, SOC], PV)).toEqual([SOC]);
  });

  test("refuses to remove the card's own metric", () => {
    // It is the card. Taking it off would leave a "draft" of unrelated metrics
    // on a card titled after a metric it no longer draws.
    expect(toggleDraft(BASE, [PV], BASE)).toEqual([PV]);
  });

  test("refuses to add the card's own metric a second time", () => {
    expect(toggleDraft(BASE, [], BASE)).toEqual([]);
  });

  test("stops at the same overlay limit a saved chart has", () => {
    // The draft is saved through the ordinary editor, so a draft that could
    // grow past the limit would be one the user cannot save.
    const full = Array.from({ length: MAX_CHART_METRICS - 1 }, (_, i) => `m${i}`);
    expect(draftMetrics(BASE, full)).toHaveLength(MAX_CHART_METRICS);
    expect(toggleDraft(BASE, full, PV)).toEqual(full);
  });

  test("still removes when the draft is at the limit", () => {
    const full = Array.from({ length: MAX_CHART_METRICS - 1 }, (_, i) => `m${i}`);
    expect(toggleDraft(BASE, full, "m0")).toHaveLength(MAX_CHART_METRICS - 2);
  });
});

describe("isDrafted", () => {
  test("the base metric always reads as on", () => {
    // It is drawn, so the picker shows it ticked — and disabled, because
    // `toggleDraft` will not take it off.
    expect(isDrafted(BASE, [], BASE)).toBe(true);
  });

  test("an added metric reads as on", () => {
    expect(isDrafted(BASE, [PV], PV)).toBe(true);
  });

  test("anything else reads as off", () => {
    expect(isDrafted(BASE, [PV], SOC)).toBe(false);
  });
});

/**
 * The wiring the data tests cannot see. Read as source text — a `.svelte` file
 * cannot be exercised under `bun test`; see apps/web/TESTING.md.
 */
const WEB = new URL("../../", import.meta.url);
const read = async (file: string): Promise<string> => await Bun.file(new URL(file, WEB)).text();

describe("the draft is wired to the card, not to the gesture", () => {
  test("the card owns the FullscreenBox rather than letting Section keep its own", async () => {
    // Not for the draft's sake any more — for `mounted`. A card expanded before
    // it scrolled into view has to mount its chart, and Section allocates its
    // box privately unless it is handed one.
    const card = await read("lib/components/inverter/entity-history-card.svelte");
    expect(card).toContain("const screen = new FullscreenBox()");
    expect(card).toMatch(/<Section[^>]*\bfullscreen\b[^>]*\{screen\}/);
  });

  test("leaving full screen does NOT clear the draft", async () => {
    // It did, back when the compare control only existed while expanded. The
    // control is in the header at every size now, so a draft built on a card in
    // the grid would be thrown away by a gesture that has nothing to do with
    // it. A draft lasts until it is cleared or saved — which is what the line
    // under the plot promises.
    const card = await read("lib/components/inverter/entity-history-card.svelte");
    expect(card).not.toMatch(/!screen\.expanded && draft/);
    expect(card).not.toMatch(/screen\.expanded[^\n]*draft = \[\]/);
  });

  test("expanding mounts the chart even if the observer never fired", async () => {
    // The card's plot is lazily mounted by an IntersectionObserver on its
    // in-flow wrapper. Expanded, the card is `fixed` and that wrapper collapses
    // to nothing — so the observer can never fire while it is full screen, and
    // a card expanded before it scrolled into view would stay a skeleton with
    // no way out of it.
    const card = await read("lib/components/inverter/entity-history-card.svelte");
    expect(card).toContain("const mounted = $derived(visible || screen.expanded)");
    expect(card).toContain("{#if !mounted}");
    expect(card).not.toMatch(/\{#if !visible\}/);
  });

  test("the compare control sits in the header cluster at every size", async () => {
    // It replaced the "add to chart" menu that used to be there. Rendered
    // unconditionally: gating it on `screen.expanded` is what made the draft's
    // lifetime a property of the full-screen gesture rather than of the card.
    const cluster = await read("lib/components/inverter/_shared/metric-card-actions.svelte");
    expect(cluster).toContain("<MetricCompareMenu base={metricKey} bind:draft />");
    expect(cluster).not.toContain("{#if");
  });

  test("nothing is left of the menu it replaced", async () => {
    // Dead code the audit would reject, and a second answer to "put this metric
    // somewhere" that no longer has a button.
    const files = [
      ...new Bun.Glob("**/*.{svelte,ts}").scanSync(new URL("../../", import.meta.url).pathname),
    ];
    expect(files).not.toContain("lib/components/inverter/_shared/metric-chart-menu.svelte");
    expect(files).not.toContain("lib/inverter/chart-membership.ts");
    const cluster = await read("lib/components/inverter/_shared/metric-card-actions.svelte");
    expect(cluster).not.toContain("MetricChartMenu");
  });

  test("a draft draws through the same renderer a saved chart uses", async () => {
    // Two renderers would be two things to keep in step; the difference between
    // a saved chart and a draft is only where the key list came from.
    const plot = await read("lib/components/inverter/_shared/metric-card-plot.svelte");
    const saved = await read("lib/components/inverter/custom-chart-card.svelte");
    expect(plot).toContain("<OverlayChartView metrics={overlay}");
    expect(saved).toContain("<OverlayChartView metrics={chart.metrics}");
  });

  test("saving hands the list to the editor that already writes custom charts", async () => {
    // Not a second create path: the draft is named and saved through the one
    // dialog that does it, seeded.
    const footer = await read("lib/components/inverter/_shared/draft-chart-footer.svelte");
    expect(footer).toContain("customCharts.seedEditor(metrics)");
    expect(footer).toContain("$session.data?.user.role === 'admin'");
  });

  test("the base metric's row is disabled, not silently ignored", async () => {
    // `toggleDraft` refuses to remove it; a checkbox that does nothing when
    // tapped reads as broken.
    const menu = await read("lib/components/inverter/_shared/metric-compare-menu.svelte");
    expect(menu).toContain("const locked = (key: string) => key === base");
    expect(menu).toContain("isLocked={locked}");
    const list = await read("lib/components/inverter/_shared/metric-picker-list.svelte");
    expect(list).toMatch(/rowDisabled = \(key: string\) => isLocked\(key\) \|\|/);
  });
});
