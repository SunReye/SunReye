import {
  doublePrecision,
  index,
  integer,
  pgTable,
  smallint,
  timestamp,
} from "drizzle-orm/pg-core";

import { devices, metricKeys } from "./plants";

/**
 * What a reading is: when, what value, from which device, which metric. Two
 * factories rather than one shared object literal — drizzle column builders are
 * bound to the table they are declared in, so two tables need two sets, and
 * `metrics_raw` interleaves `dur_ms` between the halves for alignment.
 *
 * Shared because the timeseries table and the configuration change-log record
 * the *same fact* to different destinations, and a join across them ("what was
 * the limit while this happened") only works while the identity columns agree.
 *
 * WHY int2 AND NOT TEXT (2.0.0)
 *
 * Until 2.0.0 this was `inverter_id text` + `metric text`, and both sat on the
 * hot path. Measured on this container (200,000 rows, one device, 108 metrics,
 * `deye-sg05lp3` / `battery.power`-length keys):
 *
 *                              heap      (id, metric, time) idx   total
 *   text, text                 16 MB     11 MB                    32 MB
 *   int2, int2                 9.95 MB   6.04 MB                  20 MB
 *
 * The saving is on the UNCOMPRESSED path — WAL, the two-hour hot window, both
 * indexes — and NOT on compressed chunks, where `compress_segmentby` already
 * stores the repeated text once per segment. That is the point: the objective is
 * SSD/eMMC endurance on a Home Assistant box, not footprint. A row is written
 * ~86k times a day per metric before change-encoding; bytes that never reach the
 * WAL are writes that never wear the card.
 *
 * The second, larger reason is correctness, and it is in `./plants.ts`:
 * `inverter_id` was the PROFILE id, so two identical inverters collided and a
 * profile swap orphaned all history.
 */
const instantColumns = () => ({
  time: timestamp("time", { withTimezone: true }).notNull().defaultNow(),
  value: doublePrecision("value").notNull(),
});

/**
 * The identity half: which device, which metric. Declared separately from
 * {@link instantColumns} for one physical reason — `metrics_raw` needs `dur_ms`
 * to sit BETWEEN the two halves so the fixed-width fields pack without padding
 * (see the note on the table), and a single spread cannot express that. Splitting
 * it keeps the shared shape while letting each table order its own columns.
 */
const identityColumns = () => ({
  /**
   * The device this reading is from — a real foreign key, `ON DELETE RESTRICT`.
   *
   * Verified on TimescaleDB 2.28.2: a foreign key from a hypertable to a plain
   * table is enforced from inside the chunks (the error names
   * `_hyper_1_9_chunk`), and it survives compression. So this is a constraint,
   * not a comment: a reading can never name a device that does not exist, and a
   * device that has readings cannot be deleted out from under them.
   *
   * RESTRICT, never CASCADE — anywhere near a dimension. A cascade would let one
   * `DELETE` erase five years of history, and worse, an id freed by a cascade
   * could be handed to a different device by the identity sequence and every
   * surviving rollup bucket would silently change meaning.
   */
  deviceId: smallint("device_id")
    .notNull()
    .references(() => devices.id, { onDelete: "restrict" }),
  /** The metric — same FK reasoning as {@link deviceId}. */
  metricId: smallint("metric_id")
    .notNull()
    .references(() => metricKeys.id, { onDelete: "restrict" }),
});

/**
 * Inverter samples in long ("narrow") form: one row per metric per change. This
 * keeps the schema fixed while the *set* of metrics is defined entirely by the
 * active device profile — so new inverters / downloadable profiles need no
 * migration.
 *
 * Promoted to a TimescaleDB hypertable (partitioned on `time`) with the rollup
 * generation in `../timescale/0000_baseline.sql`; drizzle owns only the column
 * shape and the two indexes.
 *
 * COLUMN ORDER IS LOAD-BEARING. `(time, value, dur_ms, device_id, metric_id)`
 * puts the two 8-byte fields first, then the 4-byte, then the two 2-byte, so
 * every field lands on its own alignment with no padding. Measured with
 * `pg_column_size` on a live row (tuple header included):
 *
 *   time, value, dur_ms, device_id, metric_id   48 B   <- this order
 *   time, dur_ms, device_id, value, metric_id   50 B
 *   time, device_id, value, metric_id, dur_ms   56 B
 *
 * 8 B/row against the worst plausible order, on the table that absorbs every
 * write. `apps/server/db-tests/baseline.test.ts` re-measures all three rather
 * than trusting the arithmetic — and it is worth re-measuring, because the order
 * is easy to lose: `dur_ms` has to be declared BETWEEN the two shared halves,
 * which is the only reason those halves are two factories and not one.
 */
export const metricsRaw = pgTable(
  "metrics_raw",
  {
    ...instantColumns(),
    /**
     * How long this row's `value` was held, in milliseconds, starting at the
     * row's own `time`.
     *
     * **Nullable with no default, on purpose** — unchanged from 1.x, and the
     * reasoning is unchanged: `NULL` means "no duration was recorded", which is
     * not a duration and must not be spelled as one. A default of `0` would be a
     * zero-width interval and a default of `1` would claim a 1 ms hold nothing
     * measured.
     *
     * What DID change in 2.0.0 is that the aggregates no longer weight by it.
     * `time_weight('LOCF', time, value)` derives each sample's span from the
     * NEXT sample's timestamp, which is the only way to get the bucket boundary
     * right: `dur_ms` weighting attributed a value held from 23:50 to 00:10
     * entirely to the 23:00 bucket, because that is where the row is stamped.
     * The column stays because it is the writer's own record of what it
     * observed, it is what a capture/replay or an import needs, and it is the
     * only evidence of a hold that ended at a restart rather than at a change.
     *
     * Deliberately not on `metrics_config_log`: an enum, a schedule slot or a
     * current limit has no time-weighted mean, and nothing reads their rollups.
     */
    durMs: integer("dur_ms"),
    ...identityColumns(),
  },
  (t) => [
    index("metrics_raw_device_metric_time_idx").on(t.deviceId, t.metricId, t.time),
    // Time-only index for pure time-range scans (e.g. /api/history). Owned by
    // drizzle so `push` doesn't try to drop it — TimescaleDB's
    // `create_hypertable` is configured with `create_default_indexes => FALSE`
    // precisely so this is the single source of truth for the time index.
    index("metrics_raw_time_idx").on(t.time.desc()),
  ],
);

/**
 * Configuration-register change-log: one row when a value the user (or the
 * automation engine) writes actually changes.
 *
 * These are not telemetry. On one measured profile 37 of 108 metrics are
 * configuration -- 30 time-of-use slots and 7 inverter settings -- and
 * persisting them to a hypertable every poll was 34 % of every row written,
 * carrying no information, in the table whose compression and retention
 * policies exist for timeseries. An enum, a schedule slot and a current limit
 * have no meaningful time-weighted mean, so nothing reads their rollups either.
 *
 * Deliberately NOT `app_settings`: `readSetting` safe-parses to the default with
 * no log, so a schema change there silently discards the record it is meant to
 * preserve. This is also why the row is typed columns rather than a JSON
 * payload -- the same reason device mappings are kept out of that table.
 *
 * Deliberately NOT a hypertable: a handful of rows a day per device. Chunking,
 * compression and a retention policy would all cost more than they save, and the
 * record is worth keeping for the life of the plant.
 *
 * It mirrors the identity change so the join in `instantColumns`' note still
 * works, and it deliberately has NO `dur_ms` — see the note on that column.
 */
export const metricsConfigLog = pgTable(
  "metrics_config_log",
  { ...instantColumns(), ...identityColumns() },
  (t) => [
    // "What was this setting at that moment", per device: the only read shape
    // this table has.
    index("metrics_config_log_device_metric_time_idx").on(t.deviceId, t.metricId, t.time.desc()),
  ],
);
