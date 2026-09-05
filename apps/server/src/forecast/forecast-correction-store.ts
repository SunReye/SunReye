/**
 * Loads the learned correction grid from the DB into the in-memory
 * {@link CorrectionModel}. Kept in its own module (not the job or the pure model)
 * so both the apply path ({@link ./solar-forecast}) and the learn job
 * ({@link ./forecast-correction-job}) can depend on it without forming an import
 * cycle, and so `solar-forecast` never statically pulls in the job graph.
 */

import { getCorrectionCells } from "@SunReye/db/forecast-correction";
import { type CorrectionModel, cellKey } from "./forecast-correction";

/** Build the in-memory grid for one inverter from its stored cell rows. */
export async function loadCorrectionModel(inverterId: string): Promise<CorrectionModel> {
  const rows = await getCorrectionCells(inverterId);
  const model: CorrectionModel = new Map();
  for (const r of rows) model.set(cellKey(r.month, r.hour), { ratio: r.ratio, weight: r.weight });
  return model;
}
