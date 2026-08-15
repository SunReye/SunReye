// Section registry for the statistics page: the four sections, in render
// order. The ids are also the keys the customize preferences hide sections by,
// so they must not change once shipped.

import type { CostBreakdown } from "@SunReye/contracts/energy";
import type { CompareMode } from "server/src/statistics/statistics";
import type { CostRange } from "$lib/cost/ranges";
import * as m from "$lib/paraglide/messages";

const SECTION_IDS = ["cost", "energy", "prices", "records"] as const;
export type SectionId = (typeof SECTION_IDS)[number];

export type SectionDef = {
  id: SectionId;
  /** Uppercase title of the section shell. */
  label: () => string;
};

export const SECTIONS: readonly SectionDef[] = [
  { id: "cost", label: m.statistics_section_costs },
  { id: "energy", label: m.statistics_section_energy },
  { id: "prices", label: m.statistics_section_prices },
  { id: "records", label: m.statistics_section_records },
];

/** One bar of the contextual cost chart. Mirrors the server's CostSeriesPoint. */
export type CostPoint = {
  bucket: string;
  importCost: number;
  exportEarnings: number;
  standingCharge: number;
  net: number;
};

/**
 * Everything the page has already fetched, handed to whichever section bodies
 * are mounted. One bag rather than per-section prop lists so adding a section
 * is a registry entry plus a body component.
 */
export type SectionData = {
  /** Cost breakdown of the picked window. */
  cost: CostBreakdown;
  /** The same breakdown over the reference window, or null when that window
   *  predates recorded history (a delta against it would be fiction). */
  previous: CostBreakdown | null;
  /** Which reference window the comparison used. */
  mode: CompareMode;
  /** Length of the picked window in days — names the "previous" reference. */
  windowDays: number;
  /** Switch the reference window. Ephemeral, available to every viewer. */
  setMode: (mode: CompareMode) => void;
  /** The picked range. Each section derives its own chart spec from it, so the
   *  page never fetches a series on their behalf. */
  range: CostRange;
};
