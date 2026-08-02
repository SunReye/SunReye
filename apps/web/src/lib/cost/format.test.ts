import { describe, expect, test } from "bun:test";
import { costFormatters } from "./format";

// Intl output is locale-dependent (separator, symbol placement), so the
// assertions pin the digits and precision rather than exact strings.

describe("money", () => {
  test("renders two fraction digits for EUR", () => {
    const { money } = costFormatters("EUR");
    expect(money(1.5)).toMatch(/1[.,]50/);
    expect(money(1.005)).toMatch(/1[.,]0[01]/); // rounded to 2dp, never 3
  });

  test("carries the given currency", () => {
    const { money } = costFormatters("GBP");
    expect(money(2)).toContain("£");
  });
});

describe("price", () => {
  test("keeps a third fraction digit for sub-cent rates", () => {
    const { price } = costFormatters("EUR");
    expect(price(0.0794)).toMatch(/0[.,]079/);
  });

  test("still shows at least two fraction digits", () => {
    const { price } = costFormatters("EUR");
    expect(price(0.3)).toMatch(/0[.,]30/);
  });

  test("does not exceed three fraction digits", () => {
    const { price } = costFormatters("EUR");
    expect(price(0.12345)).toMatch(/0[.,]123(\D|$)/);
  });
});

describe("kwh", () => {
  test("rounds to at most one fraction digit and appends the unit", () => {
    const { kwh } = costFormatters("EUR");
    expect(kwh(3.26)).toMatch(/3[.,]3 kWh$/);
    expect(kwh(12)).toMatch(/12 kWh$/);
  });
});

describe("pct", () => {
  test("renders null as an em-dash", () => {
    const { pct } = costFormatters("EUR");
    expect(pct(null)).toBe("—");
  });

  test("renders a 0..1 ratio as a whole percent", () => {
    const { pct } = costFormatters("EUR");
    expect(pct(0.5)).toBe("50%");
    expect(pct(0.678)).toBe("68%");
    expect(pct(0)).toBe("0%");
  });
});

describe("currency fallback", () => {
  test("undefined currency falls back to EUR", () => {
    const { money } = costFormatters(undefined);
    expect(money(1)).toContain("€");
  });
});
