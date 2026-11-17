// Whether a chart stands inside a detail sheet (ADR 21 "Sheet content"): there a finger reads after
// a hold, so the drawer does not follow it; on a full screen it reads at once and a tap drills.
import { createContext } from "svelte";

const [, setSheet, hasSheet] = createContext<true>();

/** For a sheet, as it is set up: the charts inside it read a held finger. */
export function markSheet(): void {
  setSheet(true);
}

/** At a chart's setup: whether it stands inside a sheet. */
export function inSheet(): boolean {
  return hasSheet();
}
