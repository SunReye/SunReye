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
