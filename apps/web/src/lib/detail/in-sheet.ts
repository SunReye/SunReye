// Whether a chart stands inside a detail sheet (ADR 21 "Sheet content"): there a finger reads after
// a hold, so the drawer does not follow it; on a full screen it reads at once and a tap drills.
import { hasContext, setContext } from "svelte";

const KEY = Symbol("sheet");

/** For a sheet, as it is set up: the charts inside it read a held finger. */
export function markSheet(): void {
  setContext(KEY, true);
}

/** At a chart's setup: whether it stands inside a sheet. */
export function inSheet(): boolean {
  return hasContext(KEY);
}

/** The context of a sheet, for a part rendered without one. */
export function sheetContext(): Map<symbol, true> {
  return new Map([[KEY, true]]);
}
