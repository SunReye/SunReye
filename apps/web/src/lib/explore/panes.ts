// Each mode's pane (ADR 22), all behind `mode.ts`'s one contract.
import FoldPane from "./FoldPane.svelte";
import OverlayPane from "./OverlayPane.svelte";
import SeriesPane from "./SeriesPane.svelte";

export const PANES = { series: SeriesPane, overlay: OverlayPane, fold: FoldPane };
