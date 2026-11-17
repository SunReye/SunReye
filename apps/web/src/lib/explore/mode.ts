// What each mode's chart is given (ADR 22): the chosen series as the catalog knows them, the range
// and the overlay's periods.
import type { RangeRoute } from "../range/route.svelte.ts";
import type { Table } from "./csv.ts";
import type { CatalogState, ExploreCore } from "./explore.svelte.ts";
import type { Chosen } from "./picker.ts";

export interface ModeProps {
  core: ExploreCore;
  /** The range, its travel and the plant's timezone and calendar. */
  route: RangeRoute;
  /** At least one; a mode of one series takes the first. */
  series: readonly Chosen[];
  /**
   * Whether the catalog was read. Once "ready", a series whose kind and instants are still null
   * has no stored history; before that, and after a failure, they are not known.
   */
  catalog: CatalogState;
  /** The overlay's earlier periods, each by a plant-local day in it. */
  periods: readonly string[];
  /** The chart's height in px. */
  height: number;
}

/** A pane's props: its mode's, and how the screen reads what it plotted, for the export. */
export interface PaneProps extends ModeProps {
  /** Set by the pane as it is built: what it plotted, null with no point drawn. */
  plotted?: (() => Table | null) | undefined;
}
