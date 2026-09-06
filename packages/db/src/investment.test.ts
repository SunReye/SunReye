import { describe, expect, test } from "bun:test";

import { INVESTMENT_KEY, defaultInvestment, investmentConfigSchema } from "./investment";

describe("investment config", () => {
  test("is stored under its own app_settings key", () => {
    expect(INVESTMENT_KEY).toBe("investment");
  });

  test("an empty blob parses to an unconfigured plant", () => {
    expect(investmentConfigSchema.parse({})).toEqual({ totalCost: 0, commissionedOn: null });
    expect(defaultInvestment).toEqual(investmentConfigSchema.parse({}));
  });

  test("round-trips a configured plant", () => {
    const input = { totalCost: 14_500, commissionedOn: "2024-05-17" };
    expect(investmentConfigSchema.parse(input)).toEqual(input);
  });

  test("a partial blob fills the missing field", () => {
    expect(investmentConfigSchema.parse({ totalCost: 100 })).toEqual({
      totalCost: 100,
      commissionedOn: null,
    });
  });

  test("rejects a negative price and a date that is not a calendar day", () => {
    expect(investmentConfigSchema.safeParse({ totalCost: -1 }).success).toBe(false);
    expect(investmentConfigSchema.safeParse({ commissionedOn: "2024-13-01" }).success).toBe(false);
    expect(investmentConfigSchema.safeParse({ commissionedOn: "17.05.2024" }).success).toBe(false);
    expect(
      investmentConfigSchema.safeParse({ commissionedOn: "2024-05-17T00:00:00Z" }).success,
    ).toBe(false);
  });

  test("an empty date string means 'not set', as a cleared form field sends it", () => {
    expect(investmentConfigSchema.parse({ commissionedOn: "" }).commissionedOn).toBeNull();
  });
});
