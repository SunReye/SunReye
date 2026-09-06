/**
 * Investment configuration — what the plant cost and when it went live, the two
 * facts the amortisation statistics need that no register can supply. Stored
 * in `app_settings` under {@link INVESTMENT_KEY} and validated with
 * {@link investmentConfigSchema} on read/write. Shared by the server (the
 * amortisation calc) and the web app (settings form), so the shape lives here.
 *
 * Shape rules (readSetting safeParses to the default, so a shape mismatch
 * silently resets the stored value — see tariff.ts): a flat record, every
 * field defaulted, no discriminated unions.
 */

import { z } from "zod";

/** `app_settings.key` under which the investment config is stored. */
export const INVESTMENT_KEY = "investment";

/** A calendar day, `YYYY-MM-DD`, that actually exists. */
const calendarDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const [y, m, d] = s.split("-").map(Number) as [number, number, number];
    const date = new Date(Date.UTC(y, m - 1, d));
    return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
  }, "not a calendar day");

export const investmentConfigSchema = z.object({
  /** What the plant cost, all in, in the tariff's currency. 0 = not configured. */
  totalCost: z.number().nonnegative().default(0),
  /**
   * The day the plant went live (`YYYY-MM-DD`), or null when unknown. A cleared
   * form field arrives as "" and means the same thing as null.
   */
  commissionedOn: z.preprocess((v) => (v === "" ? null : v), calendarDay.nullable().default(null)),
});
export type InvestmentConfig = z.infer<typeof investmentConfigSchema>;

/** Not configured: no price, no date. */
export const defaultInvestment: InvestmentConfig = investmentConfigSchema.parse({});
