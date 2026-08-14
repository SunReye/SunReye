/**
 * CRUD accessor over the `custom_charts` table. Pure persistence: metric-key
 * validation against the active profile happens at the route edge (which holds
 * the profile context). Each row's `data` JSONB is validated with the shared
 * Zod schema on read, so a hand-edited/legacy blob can't crash the list.
 */

import { db } from "@SunReye/db";
import {
  type CustomChart,
  type CustomChartInput,
  customChartConfigSchema,
  customChartInputSchema,
} from "@SunReye/db/custom-charts";
import { type CustomChartRow, customCharts } from "@SunReye/db/schema/custom-charts";
import { desc, eq } from "drizzle-orm";

/** Flatten a row into the API shape (config unpacked, timestamps as ISO). */
function toChart(row: CustomChartRow): CustomChart {
  const config = customChartConfigSchema.parse(row.data);
  return {
    id: row.id,
    name: row.name,
    metrics: config.metrics,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** All custom charts, most-recently-updated first. */
export async function listCharts(): Promise<CustomChart[]> {
  const rows = await db.select().from(customCharts).orderBy(desc(customCharts.updatedAt));
  return rows.map(toChart);
}

/** Validate + insert a new chart, returning the stored record. */
export async function createChart(input: CustomChartInput): Promise<CustomChart> {
  const { name, ...config } = customChartInputSchema.parse(input);
  const [row] = await db
    .insert(customCharts)
    .values({ id: crypto.randomUUID(), name, data: config })
    .returning();
  return toChart(row!);
}

/** Validate + update a chart; `null` when no row matches the id. */
export async function updateChart(
  id: string,
  input: CustomChartInput,
): Promise<CustomChart | null> {
  const { name, ...config } = customChartInputSchema.parse(input);
  const [row] = await db
    .update(customCharts)
    .set({ name, data: config })
    .where(eq(customCharts.id, id))
    .returning();
  return row ? toChart(row) : null;
}

/** Delete a chart; `false` when no row matched. */
export async function deleteChart(id: string): Promise<boolean> {
  const [row] = await db
    .delete(customCharts)
    .where(eq(customCharts.id, id))
    .returning({ id: customCharts.id });
  return row !== undefined;
}
