// What a tap on a band opens, by the range's grain.
import { m } from "../paraglide/messages.js";
import { grainOf, type Grain, type Range } from "../range/range.ts";

const LABELS: Readonly<Record<Grain, () => string>> = {
  hour: m.stats_drill_hour,
  day: m.stats_drill_day,
  week: m.stats_drill_week,
  month: m.stats_drill_month,
  year: m.stats_drill_year,
};

export const drillLabel = (r: Range): string => LABELS[grainOf(r)]();
