import {
  bigint,
  integer,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import { devices } from "./plants";

/**
 * The bucket replay's watermark: one row per COMPLETED chunk.
 *
 * WHY A TABLE AND NOT A COUNTER IN MEMORY
 *
 * The replay this table serves has exactly one production attempt, and it runs in
 * a place that gets killed: a Home Assistant addon, on a box that loses power, on
 * a Supervisor that will restart a container it thinks has hung, over a span
 * whose full run is minutes of solid inserting. So it is chunked by day, and each
 * chunk's rows and ITS ROW HERE are written in the SAME transaction. That single
 * property is the whole of resumability and idempotence:
 *
 *  * killed mid-chunk -> the transaction rolls back, the chunk has no row here,
 *    and the next run redoes exactly that chunk;
 *  * finished -> every chunk has a row, and a re-run replays nothing at all.
 *
 * Nothing weaker works. A watermark written after a commit can be lost between
 * the two and would double-insert a day of buckets; a `max(time)` probe of
 * `metrics_raw` cannot distinguish replayed history from live polling.
 *
 * WHY IT IS NOT DROPPED WHEN THE UPGRADE FINISHES
 *
 * It is the only record that the upgrade's backfill ran, which day it reached,
 * from which tier and how many rows it wrote — the first thing anyone asks when
 * a chart looks short. `source` and `tier` are stored per row (rather than the
 * span being keyed by tier) because the same span must never be replayed twice
 * just because a later run found a finer tier still covering it; see
 * `chunkKey` in `../replay.ts`.
 *
 * Deliberately NOT a hypertable: one row per device per day of history, ~60 rows
 * for the upgrade this exists for.
 */
export const replayProgress = pgTable(
  "replay_progress",
  {
    /**
     * The relation the buckets were read from, e.g. `legacy_minute_rollups`.
     *
     * Part of the key, so two sources — the in-place upgrade's renamed
     * aggregates and an import's staging table — can be replayed into the same
     * database without either believing the other's days are done.
     */
    source: text("source").notNull(),
    /** The device the replayed rows were written for. */
    deviceId: smallint("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "restrict" }),
    /** Start of the completed chunk — the watermark itself. */
    chunkStart: timestamp("chunk_start", { withTimezone: true }).notNull(),
    /** Exclusive end of the completed chunk, so a partial day is legible. */
    chunkEnd: timestamp("chunk_end", { withTimezone: true }).notNull(),
    /** Which tier answered this chunk. Recorded, never part of the identity. */
    tier: text("tier").notNull(),
    /** Rows written to `metrics_raw` for this chunk. */
    seriesRows: bigint("series_rows", { mode: "number" }).notNull(),
    /** Rows written to `metrics_config_log` for this chunk. */
    configRows: bigint("config_rows", { mode: "number" }).notNull(),
    /** Wall clock the chunk took, for the next operator's sizing decision. */
    elapsedMs: integer("elapsed_ms").notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.source, t.deviceId, t.chunkStart] })],
);
