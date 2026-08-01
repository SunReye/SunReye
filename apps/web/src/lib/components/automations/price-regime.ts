/**
 * Presentation for the price-aware regime — a sibling of `run-state.ts`.
 *
 * Deliberately separate from the run state rather than folded into it: what the
 * loop is doing about *prices* is orthogonal to whether it is steering at all,
 * and merging them would turn two small enums into their cross product.
 */

import * as m from "$lib/paraglide/messages";
import type { PriceRegime } from "server/src/price-plan";
import type { BadgeVariant } from "./run-state";

export const REGIME_LABEL: Record<PriceRegime, () => string> = {
  none: m.price_regime_none,
  waiting: m.price_regime_waiting,
  "pre-shape": m.price_regime_pre_shape,
  "spend-down": m.price_regime_spend_down,
  absorb: m.price_regime_absorb,
};

export const REGIME_VARIANT: Record<PriceRegime, BadgeVariant> = {
  none: "outline",
  waiting: "secondary",
  "pre-shape": "secondary",
  // The pack cannot make room by withholding alone — worth the user's attention,
  // since shifting load into the window is what closes the gap.
  "spend-down": "destructive",
  absorb: "default",
};
