import { describe, expect, test } from "bun:test";

import {
  OPTIMIZER_MODES,
  OPTIMIZER_PRICE_REGIMES,
  OPTIMIZER_RUN_STATES,
} from "./optimizer-vocabulary";

describe("the optimizer's stored vocabularies are frozen by position", () => {
  test("the run states are exactly this list, in exactly this order", () => {
    // The ordinal is what five years of `metrics_raw` rows MEAN. Reordering or
    // inserting silently re-labels every row ever written, on the server that
    // writes them and in the chart that reads them back — which is why there is
    // one list rather than a copy per side. Append at the end, never insert.
    expect([...OPTIMIZER_RUN_STATES]).toEqual([
      "disabled",
      "blocked",
      "idle",
      "active",
      "shadow",
      "simulating",
      "stale",
    ]);
  });

  test("the price regimes are frozen too", () => {
    expect([...OPTIMIZER_PRICE_REGIMES]).toEqual([
      "none",
      "waiting",
      "pre-shape",
      "spend-down",
      "absorb",
    ]);
  });

  test("the modes are frozen too", () => {
    expect([...OPTIMIZER_MODES]).toEqual(["maximize-exports", "grid-friendly"]);
  });

  test("no value appears twice — an ordinal must name exactly one state", () => {
    for (const vocabulary of [OPTIMIZER_RUN_STATES, OPTIMIZER_PRICE_REGIMES, OPTIMIZER_MODES]) {
      expect(new Set(vocabulary).size).toBe(vocabulary.length);
    }
  });
});
