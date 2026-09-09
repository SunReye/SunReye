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
  chartSeries,
  customChartConfigSchema,
  customChartInputSchema,
  soleInverterSlug,
} from "@SunReye/db/custom-charts";
import { readDevices, readPlant } from "@SunReye/db/plant-repo";
import { type CustomChartRow, customCharts } from "@SunReye/db/schema/custom-charts";
import { desc, eq } from "drizzle-orm";

/**
 * The slug an unqualified series belongs to, or null when the plant cannot say.
 *
 * `readPlant`, not `plantFacts.plant()`: that one PROVISIONS on first use, and a
 * read of the chart list must not create rows. A plant that does not exist yet
 * simply has no default, which is the same answer as a plant with two inverters
 * and the same one the read path handled before this field existed.
 */
async function defaultChartDevice(): Promise<string | null> {
  const plant = await readPlant(db);
  if (plant === null) return null;
  return soleInverterSlug(await readDevices(db, plant.id));
}

/**
 * Flatten a row into the API shape (config unpacked, timestamps as ISO).
 *
 * The config is SPREAD rather than copied field by field. An enumeration here
 * silently strips whatever the config learns to say next — the per-series device
 * slugs did exactly that until this line changed — and it fails as a chart that
 * renders fine while quietly forgetting which inverter it was about. Spreading
 * is safe because `config` came out of `customChartConfigSchema`, so it holds
 * nothing the schema did not accept.
 *
 * `series` is DERIVED on every read and is not part of the stored document: it is
 * `metrics` with each entry's device resolved (the stated slug, else the plant's
 * sole inverter). Resolving it here rather than persisting it is the whole point —
 * writing today's inference back into the JSONB would turn a guess into a stated
 * fact, and the write path re-parses with `customChartInputSchema`, which strips
 * it if a client echoes it back.
 */
function toChart(row: CustomChartRow, defaultDevice: string | null): CustomChart {
  const config = customChartConfigSchema.parse(row.data);
  return {
    id: row.id,
    name: row.name,
    ...config,
    series: chartSeries(config, defaultDevice),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** All custom charts, most-recently-updated first. */
export async function listCharts(): Promise<CustomChart[]> {
  const [rows, defaultDevice] = await Promise.all([
    db.select().from(customCharts).orderBy(desc(customCharts.updatedAt)),
    defaultChartDevice(),
  ]);
  return rows.map((row) => toChart(row, defaultDevice));
}

/** Validate + insert a new chart, returning the stored record. */
export async function createChart(input: CustomChartInput): Promise<CustomChart> {
  const { name, ...config } = customChartInputSchema.parse(input);
  const [row] = await db
    .insert(customCharts)
    .values({ id: crypto.randomUUID(), name, data: config })
    .returning();
  return toChart(row!, await defaultChartDevice());
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
  return row ? toChart(row, await defaultChartDevice()) : null;
}

/** Delete a chart; `false` when no row matched. */
export async function deleteChart(id: string): Promise<boolean> {
  const [row] = await db
    .delete(customCharts)
    .where(eq(customCharts.id, id))
    .returning({ id: customCharts.id });
  return row !== undefined;
}
