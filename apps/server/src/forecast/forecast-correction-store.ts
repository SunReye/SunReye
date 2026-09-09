/**
 * The learned PV-forecast correction's identity boundary, and the loader for the
 * in-memory {@link CorrectionModel}.
 *
 * `packages/db/src/forecast-correction.ts` is keyed by `deviceId: number` — the
 * column's own type, correct for a data layer. Everything above this module works
 * in SOURCE IDS: `resolvePvSource` takes the id the live sample carries (falling
 * back to the profile id), the API exposes it, and the correction view renders
 * it. So this is where names become the int2 and back.
 *
 * Kept in its own module (not the job, not the pure model) so both the apply path
 * ({@link ./solar-forecast}) and the learn job
 * ({@link ./forecast-correction-job}) can depend on it without forming an import
 * cycle, and so `solar-forecast` never statically pulls in the job graph.
 *
 * WHY AN UNRESOLVABLE DEVICE WRITES NOTHING AT ALL
 *
 * Nothing creates a `devices` row yet (provisioning belongs to the onboarding
 * wave), so a plant can run a learn pass before its device exists. Writing the
 * CURSOR while the cells could not be written would be the worst outcome: the
 * next run would skip the settled days it never actually learned, permanently.
 * So both writes resolve first and both no-op together.
 */

import { db } from "@SunReye/db";
import {
  getCorrectionCells,
  getCorrectionState,
  upsertCorrectionCells,
  upsertCorrectionState,
} from "@SunReye/db/forecast-correction";
import { resolveDeviceId } from "../shared/identity";
import { type CorrectionModel, cellKey } from "./forecast-correction";

/** One stored grid cell, named by the source id the caller asked for. */
export interface CorrectionCellRow {
  inverterId: string;
  month: number;
  hour: number;
  ratio: number;
  weight: number;
  updatedAt: Date;
}

/** One cell to persist — no `updatedAt`, which the upsert stamps itself. */
export interface CorrectionCellWrite {
  inverterId: string;
  month: number;
  hour: number;
  ratio: number;
  weight: number;
}

/** The learn cursor + skill stats, named by source id. */
export interface CorrectionStateRow {
  inverterId: string;
  learnedThrough: string | null;
  maeRaw: number;
  maeCorrected: number;
  samples: number;
  updatedAt: Date;
}

/** The cursor + skill stats to persist. */
export interface CorrectionStateWrite {
  inverterId: string;
  learnedThrough: string;
  maeRaw: number;
  maeCorrected: number;
  samples: number;
}

/** Every learned cell for one source, unordered. Empty for an unknown device. */
export async function readCorrectionCells(inverterId: string): Promise<CorrectionCellRow[]> {
  const deviceId = await resolveDeviceId(db, inverterId);
  if (deviceId === null) return [];
  const rows = await getCorrectionCells(deviceId);
  // The source id is stamped back from the ARGUMENT rather than looked up from
  // the device: the caller asked for one source's grid, so every row is that
  // source's by construction, and a reverse lookup would be a second round trip
  // to learn something already known.
  return rows.map((r) => ({
    inverterId,
    month: r.month,
    hour: r.hour,
    ratio: r.ratio,
    weight: r.weight,
    updatedAt: r.updatedAt,
  }));
}

/** The learn cursor for one source, or null before its first run. */
export async function readCorrectionState(inverterId: string): Promise<CorrectionStateRow | null> {
  const deviceId = await resolveDeviceId(db, inverterId);
  if (deviceId === null) return null;
  const row = await getCorrectionState(deviceId);
  return row === null
    ? null
    : {
        inverterId,
        learnedThrough: row.learnedThrough,
        maeRaw: row.maeRaw,
        maeCorrected: row.maeCorrected,
        samples: row.samples,
        updatedAt: row.updatedAt,
      };
}

/**
 * Persist a batch of cells, dropping the ones whose device does not exist.
 *
 * An empty batch writes nothing: `upsertCorrectionCells` returns early on one
 * anyway, and resolving a device for a batch with no rows is a wasted round trip.
 */
export async function writeCorrectionCells(cells: readonly CorrectionCellWrite[]): Promise<void> {
  if (cells.length === 0) return;
  const sources = [...new Set(cells.map((c) => c.inverterId))];
  const ids = new Map<string, number>();
  for (const source of sources) {
    const id = await resolveDeviceId(db, source);
    if (id !== null) ids.set(source, id);
  }
  const rows = cells.flatMap((c) => {
    const deviceId = ids.get(c.inverterId);
    return deviceId === undefined
      ? []
      : [{ deviceId, month: c.month, hour: c.hour, ratio: c.ratio, weight: c.weight }];
  });
  if (rows.length === 0) return;
  await upsertCorrectionCells(rows);
}

/** Advance the cursor + skill stats. A no-op when the device does not exist. */
export async function writeCorrectionState(state: CorrectionStateWrite): Promise<void> {
  const deviceId = await resolveDeviceId(db, state.inverterId);
  if (deviceId === null) return;
  await upsertCorrectionState({
    deviceId,
    learnedThrough: state.learnedThrough,
    maeRaw: state.maeRaw,
    maeCorrected: state.maeCorrected,
    samples: state.samples,
  });
}

/** Build the in-memory grid for one source from its stored cell rows. */
export async function loadCorrectionModel(inverterId: string): Promise<CorrectionModel> {
  const rows = await readCorrectionCells(inverterId);
  const model: CorrectionModel = new Map();
  for (const r of rows) model.set(cellKey(r.month, r.hour), { ratio: r.ratio, weight: r.weight });
  return model;
}
