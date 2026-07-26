import { jsonb, pgTable, text } from "drizzle-orm/pg-core";

import { createdAtTz, updatedAtTz } from "./columns";

/**
 * User-defined "custom charts" for the history page: a named selection of
 * metric keys plotted together on one multi-series chart. `data` holds the
 * validated {@link @SunReye/db/custom-charts.CustomChartConfig} (metric keys +
 * chart type); `name` is a column so the list can be ordered/filtered without
 * unpacking the blob. Instance-wide (no per-user scoping), matching the rest
 * of the settings surface.
 */
export const customCharts = pgTable("custom_charts", {
  /** Opaque id (generated server-side). */
  id: text("id").primaryKey(),
  /** Human label shown as the card title. */
  name: text("name").notNull(),
  /** The validated `CustomChartConfig` blob (metrics + chart type). */
  data: jsonb("data").notNull(),
  createdAt: createdAtTz(),
  updatedAt: updatedAtTz(),
});

export type CustomChartRow = typeof customCharts.$inferSelect;
export type CustomChartInsert = typeof customCharts.$inferInsert;
