// What each mode's chart is given (ADR 22): the chosen series as the catalog knows them, the range
// and the overlay's periods. Series (#793), Overlay (#794) and Fold (#795) each fill their pane.
import type { RangeRoute } from "../range/route.svelte.ts";
import type { ExploreCore } from "./explore.svelte.ts";
import type { Chosen } from "./picker.ts";

export interface ModeProps {
  core: ExploreCore;
  /** The range, its travel and the plant's timezone and calendar. */
  route: RangeRoute;
  /** At least one; a mode of one series takes the first. */
  series: readonly Chosen[];
  /** The overlay's earlier periods, each by a plant-local day in it. */
  periods: readonly string[];
  /** The chart's height in px. */
  height: number;
}
