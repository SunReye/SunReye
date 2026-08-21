// The comparison reference the whole page is priced against.
//
// Its control used to live inside the Records section, which is the one place it
// does not belong: `mode` is `+page.svelte`'s state, it is a parameter of the
// comparison request, and every section's delta chips and every section caption
// are re-based by it. A page control in a section header is what made that
// header read as a second toolbar — so the options live here, where the page
// toolbar and its test can both reach them.

import type { CompareMode } from "@SunReye/contracts/statistics";
import * as m from "$lib/paraglide/messages";

/** The two reference windows the comparison endpoint prices, in toolbar order. */
export const compareModes = (): readonly { id: CompareMode; label: string }[] => [
  { id: "previous", label: m.statistics_compare_previous() },
  { id: "yearAgo", label: m.statistics_compare_year_ago() },
];
