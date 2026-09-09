/**
 * Persistence for the learned PV-forecast correction. Row-level read/write over
 * the two tables in {@link @SunReye/db/schema/forecast-correction}; the server
 * (`apps/server/src/forecast/forecast-correction*`) owns the in-memory grid and the
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

/** All learned cells for one device (the grid rows, unordered). */
export function getCorrectionCells(deviceId: number): Promise<ForecastCorrectionCellRow[]> {
  return db
    .select()
    .from(forecastCorrectionCells)
    .where(eq(forecastCorrectionCells.deviceId, deviceId));
}

/** Upsert a batch of cells (insert new, overwrite the ratio/weight of existing). */
export async function upsertCorrectionCells(cells: ForecastCorrectionCellInsert[]): Promise<void> {
  if (cells.length === 0) return;
  await db
    .insert(forecastCorrectionCells)
    .values(cells)
    .onConflictDoUpdate({
      target: [
        forecastCorrectionCells.deviceId,
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

/** The learn cursor + skill stats for one device, or null before the first run. */
export async function getCorrectionState(
  deviceId: number,
): Promise<ForecastCorrectionStateRow | null> {
  const [row] = await db
    .select()
    .from(forecastCorrectionState)
    .where(eq(forecastCorrectionState.deviceId, deviceId));
  return row ?? null;
}

/** Advance the cursor + skill stats for one device. */
export async function upsertCorrectionState(state: {
  deviceId: number;
  learnedThrough: string;
  maeRaw: number;
  maeCorrected: number;
  samples: number;
}): Promise<void> {
  await db
    .insert(forecastCorrectionState)
    .values(state)
    .onConflictDoUpdate({
      target: forecastCorrectionState.deviceId,
      set: {
        learnedThrough: state.learnedThrough,
        maeRaw: state.maeRaw,
        maeCorrected: state.maeCorrected,
        samples: state.samples,
        updatedAt: sql`now()`,
      },
    });
}
