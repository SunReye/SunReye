import type { Attempt } from "../api/core";
import { m } from "../paraglide/messages.js";

/** Every outcome's text; an outcome the core gains fails the type check until it has one. */
export const OUTCOMES: Readonly<Record<Attempt["outcome"], () => string>> = {
  verified: m.outcome_verified,
  mismatch: m.outcome_mismatch,
  unknown: m.outcome_unknown,
  partial: m.outcome_partial,
  unchanged: m.outcome_unchanged,
};
