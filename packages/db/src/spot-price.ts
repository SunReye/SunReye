/**
 * Persistence for day-ahead spot prices. Row-level read/write over the table in
 * {@link @SunReye/db/schema/spot-price}; the server (`apps/server/src/spot-price*`)
 * owns slot geometry, completeness and every pricing formula, so this module
 * stays a thin, dependency-free data layer.
 */

import { and, asc, count, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "./index";
import { type SpotPriceInsert, type SpotPriceRow, spotPrices } from "./schema/spot-price";

/** Slots for one zone in `[from, to)`, oldest first. */
export function getSpotPrices(zone: string, from: Date, to: Date): Promise<SpotPriceRow[]> {
  return db
    .select()
    .from(spotPrices)
    .where(
      and(eq(spotPrices.zone, zone), gte(spotPrices.slotStart, from), lt(spotPrices.slotStart, to)),
    )
    .orderBy(asc(spotPrices.slotStart));
}

/**
 * Upsert a batch of slots. A published price never changes, but a re-publication
 * at finer resolution must overwrite the coarse row, so the conflict updates the
 * price *and* the width.
 */
export async function upsertSpotPrices(rows: SpotPriceInsert[]): Promise<void> {
  if (rows.length === 0) return;
  await db
    .insert(spotPrices)
    .values(rows)
    .onConflictDoUpdate({
      target: [spotPrices.zone, spotPrices.slotStart],
      set: {
        slotMinutes: sql`excluded.slot_minutes`,
        eurPerMwh: sql`excluded.eur_per_mwh`,
        provider: sql`excluded.provider`,
        updatedAt: sql`now()`,
      },
    });
}

/**
 * How many slots are stored for one zone in `[from, to)`. The job's completeness
 * check: compared against the expected count for the delivery day, this is the
 * whole cursor — there is no cursor row to advance or corrupt.
 */
export async function countSpotPrices(zone: string, from: Date, to: Date): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(spotPrices)
    .where(
      and(eq(spotPrices.zone, zone), gte(spotPrices.slotStart, from), lt(spotPrices.slotStart, to)),
    );
  return row?.n ?? 0;
}
