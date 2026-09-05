import {
  doublePrecision,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import { updatedAtTz } from "./columns";

/**
 * Day-ahead wholesale electricity prices, one row per market time unit (MTU).
 *
 * Needed because §51 EEG pays a plant **nothing** for energy exported during a
 * quarter-hour whose day-ahead price was negative, so "which slots are negative"
 * is a first-class input to both the cost engine and the automations.
 *
 * A plain relational table, not a hypertable / continuous aggregate: 96 rows per
 * day per zone is ~35k rows a year, far below the point where chunking earns its
 * keep — the same reasoning as `./forecast-correction`. Unlike that grid, these
 * rows are **externally sourced and immutable**, not derived from the
 * measurements, so they are deliberately *not* cleared on a data reset and have
 * no retention policy: re-pricing history is the whole reason they are stored,
 * and old delivery days cannot be re-fetched from a day-ahead endpoint.
 *
 * `slot_start` is an absolute instant rather than a local wall-clock string
 * (which is how the *forecast* series is keyed, because Open-Meteo speaks local
 * time). Auction products are UTC-anchored, so instants make DST free: a spring
 * day is simply 92 rows and an autumn day 100, with no special case, and the
 * doubled local `02:00` label is purely a rendering concern.
 */
export const spotPrices = pgTable(
  "spot_prices",
  {
    /** Bidding zone / market area, e.g. `DE-LU`. */
    zone: text("zone").notNull(),
    /** Slot start as an absolute instant. */
    slotStart: timestamp("slot_start", { withTimezone: true }).notNull(),
    /**
     * Nominal width the upstream published, minutes (15 or 60). Deliberately not
     * part of the key: a re-publication at finer resolution must overwrite the
     * coarse row, not sit beside it. Hourly sources are fanned out to
     * quarter-hour rows on ingest, and this records that the *source* was
     * hourly — i.e. that a negative quarter-hour inside a positive hour was not
     * resolvable.
     */
    slotMinutes: integer("slot_minutes").notNull(),
    /** Wholesale price for the slot, EUR/MWh. **Signed** — negatives are the point. */
    eurPerMwh: doublePrecision("eur_per_mwh").notNull(),
    /** Provider id the row came from, for provenance. */
    provider: text("provider").notNull(),
    updatedAt: updatedAtTz(),
  },
  // `(zone, slot_start)` is both the upsert conflict target and, being the
  // primary key, the index every read wants: one zone over one time range.
  (t) => [primaryKey({ columns: [t.zone, t.slotStart] })],
);

export type SpotPriceRow = typeof spotPrices.$inferSelect;
export type SpotPriceInsert = typeof spotPrices.$inferInsert;
