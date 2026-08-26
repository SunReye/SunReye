import { doublePrecision, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * The four columns a reading is: when, from which device, which metric, what
 * value. A factory rather than a shared object literal — drizzle column builders
 * are bound to the table they are declared in, so two tables need two sets.
 *
 * Shared because the timeseries table and the configuration change-log record
 * the *same fact* to different destinations, and a join across them ("what was
 * the limit while this happened") only works while the identity columns agree.
 */
const readingColumns = () => ({
  time: timestamp("time", { withTimezone: true }).notNull().defaultNow(),
  inverterId: text("inverter_id").notNull(),
  metric: text("metric").notNull(),
  value: doublePrecision("value").notNull(),
});

/**
 * 1-second resolution inverter samples in long ("narrow") form: one row per
 * metric per tick. This keeps the schema fixed while the *set* of metrics is
 * defined entirely by the active inverter profile — so new inverters /
 * downloadable config packages need no migration.
 *
 * Promoted to a TimescaleDB hypertable (partitioned on `time`) with per-metric
 * continuous-aggregate rollups by the raw SQL in `src/timescale.sql`; drizzle
 * only manages the column shape. Apply via `bun run db:timescale`.
 */
export const metricsRaw = pgTable("metrics_raw", readingColumns(), (t) => [
  index("metrics_raw_metric_time_idx").on(t.inverterId, t.metric, t.time),
  // Time-only index for pure time-range scans (e.g. /api/history). Owned by
  // drizzle so `push` doesn't try to drop it — TimescaleDB's `create_hypertable`
  // is configured with `create_default_indexes => FALSE` precisely so this is
  // the single source of truth for the time index (see src/timescale.sql).
  index("metrics_raw_time_idx").on(t.time.desc()),
]);

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
 */
export const metricsConfigLog = pgTable("metrics_config_log", readingColumns(), (t) => [
  // "What was this setting at that moment", per device: the only read shape
  // this table has.
  index("metrics_config_log_metric_time_idx").on(t.inverterId, t.metric, t.time.desc()),
]);
