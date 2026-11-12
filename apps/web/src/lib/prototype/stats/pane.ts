// PROTOTYPE: what a pager pane tells the content it holds.
import { createContext } from "svelte";

export interface PaneInfo {
  /** The pane arrives already in motion (a slide, a peek): content draws in place, without its own entrance. */
  instant: boolean;
}
export const [getPane, setPane] = createContext<PaneInfo>();
