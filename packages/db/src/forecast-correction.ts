/**
 * Persistence for the learned PV-forecast correction. Row-level read/write over
 * the two tables in {@link @SunReye/db/schema/forecast-correction}; the server
 * (`apps/server/src/forecast-correction*`) owns the in-memory grid and the
 * learning math, so this module stays a thin, dependency-free data layer.
 */

import { eq, sql } from "drizzle-orm";
import { db } from "./index";
import {
  type ForecastCorrectionCellInsert,
  type ForecastCorrectionCellRow,
  type ForecastCorrectionStateRow,
  forecastCorrectionCells,
  forecastCorrectionState,
} from "./schema/forecast-correction";

/** All learned cells for one inverter (the grid rows, unordered). */
export function getCorrectionCells(inverterId: string): Promise<ForecastCorrectionCellRow[]> {
  return db
    .select()
    .from(forecastCorrectionCells)
    .where(eq(forecastCorrectionCells.inverterId, inverterId));
}

/** Upsert a batch of cells (insert new, overwrite the ratio/weight of existing). */
export async function upsertCorrectionCells(cells: ForecastCorrectionCellInsert[]): Promise<void> {
  if (cells.length === 0) return;
  await db
    .insert(forecastCorrectionCells)
    .values(cells)
    .onConflictDoUpdate({
      target: [
        forecastCorrectionCells.inverterId,
        forecastCorrectionCells.month,
        forecastCorrectionCells.hour,
      ],
      set: {
        ratio: sql`excluded.ratio`,
        weight: sql`excluded.weight`,
        updatedAt: sql`now()`,
      },
    });
}

/** The learn cursor + skill stats for one inverter, or null before the first run. */
export async function getCorrectionState(
  inverterId: string,
): Promise<ForecastCorrectionStateRow | null> {
  const [row] = await db
    .select()
    .from(forecastCorrectionState)
    .where(eq(forecastCorrectionState.inverterId, inverterId));
  return row ?? null;
}

/** Advance the cursor + skill stats for one inverter. */
export async function upsertCorrectionState(state: {
  inverterId: string;
  learnedThrough: string;
  maeRaw: number;
  maeCorrected: number;
  samples: number;
}): Promise<void> {
  await db
    .insert(forecastCorrectionState)
    .values(state)
    .onConflictDoUpdate({
      target: forecastCorrectionState.inverterId,
      set: {
        learnedThrough: state.learnedThrough,
        maeRaw: state.maeRaw,
        maeCorrected: state.maeCorrected,
        samples: state.samples,
        updatedAt: sql`now()`,
      },
    });
}
