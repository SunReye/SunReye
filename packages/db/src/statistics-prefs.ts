/**
 * Statistics page preferences — which sections/tiles the web app hides and the
 * per-section display options. Stored in `app_settings` under the key
 * {@link STATISTICS_PREFS_KEY} and validated with {@link statisticsPrefsSchema}
 * on read/write. A single instance-wide setting, mirroring the uiPrefs pattern.
 *
 * Shape rules (readSetting safeParses to the default silently — a shape
 * mismatch wipes the stored preference without a log):
 *  - NO discriminated unions in `app_settings` blobs — keep this a flat record.
 *  - Every field (and every nested object) must carry `.default()` so `{}` and
 *    any older stored blob still parse; new fields added later must always
 *    carry `.default()` too, or existing installs silently reset to defaults.
 */

import { z } from "zod";

/** `app_settings.key` under which the statistics preferences are stored. */
export const STATISTICS_PREFS_KEY = "statisticsPrefs";

export const statisticsPrefsSchema = z
  .object({
    /** Section ids hidden from the statistics page (loose strings — no
     *  db-package lockstep with the web app's section registry). */
    hiddenSections: z.array(z.string()).default([]),
    /** Individual tiles hidden, namespaced as `section.tileId`. */
    hiddenTiles: z.array(z.string()).default([]),
    /** Sections rendered collapsed by default; viewers can still expand. */
    collapsedSections: z.array(z.string()).default([]),
    /** Cost section options. */
    cost: z
      .object({
        /** Default chart scope: bucket inside the range, or zoom one level out. */
        chartScope: z.enum(["detail", "context"]).default("detail"),
      })
      .default({ chartScope: "detail" }),
    /** Energy section options. */
    energy: z
      .object({
        /** Default series bucket for the energy charts. */
        bucket: z.enum(["day", "month"]).default("day"),
        /** Default chart scope: bucket inside the range, or zoom one level out. */
        chartScope: z.enum(["detail", "context"]).default("detail"),
        /** Default metric the hour-weekday heatmap colors by. */
        heatmapField: z.enum(["load", "import", "export", "production"]).default("load"),
      })
      .default({ bucket: "day", chartScope: "detail", heatmapField: "load" }),
    /** Spot price section options. */
    prices: z
      .object({
        /** Analysis window for the price statistics, in days. */
        windowDays: z.number().int().min(7).max(1095).default(90),
      })
      .default({ windowDays: 90 }),
    /** Comparisons & records section options. */
    records: z
      .object({
        /** Default comparison window: adjacent same-length, or a year back. */
        compareMode: z.enum(["previous", "yearAgo"]).default("previous"),
        /** Default metric for the year-over-year chart. */
        yoyMetric: z.enum(["net", "production"]).default("net"),
      })
      .default({ compareMode: "previous", yoyMetric: "net" }),
  })
  .strict();
export type StatisticsPrefs = z.infer<typeof statisticsPrefsSchema>;

/** Everything visible, default options — before any preference is configured. */
export const defaultStatisticsPrefs: StatisticsPrefs = statisticsPrefsSchema.parse({});
