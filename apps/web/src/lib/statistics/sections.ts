// Section registry for the statistics page. Only `cost` has content today;
// energy, prices and records arrive in later waves — their ids and labels are
// fixed here already because the customize preferences and message keys must
// stay stable across those waves.

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
