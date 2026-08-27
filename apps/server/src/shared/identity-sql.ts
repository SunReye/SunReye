/**
 * The identity boundary: names in, int2 ids out — as SQL, not as awaited
 * numbers.
 *
 * 2.0.0 re-keyed the timeseries from `(inverter_id text, metric text)` to
 * `(device_id int2, metric_id int2)`. That is a STORAGE decision (see
 * `packages/db/src/schema/metrics.ts` for the measured bytes) and it must stop
 * at the database's edge:
 *
 *  - every route, MQTT topic, HA `unique_id`, CSV column and saved
 *    `custom_charts.data` document names a device by `devices.slug` and a metric
 *    by `metric_keys.key`;
 *  - the int2 is chosen for bytes on the write path and is renumbered by nothing
 *    today only because nothing renumbers it. A stored id in a user artifact — a
 *    saved chart, an export, a URL — would rot the first time a database is
 *    restored or a device re-added.
 *
 * So the translation lives here, and it is a SQL EXPRESSION rather than an
 * `await resolveDeviceId(...)`. Three reasons, all of them load-bearing:
 *
 *  1. The read-path composers (`./rollup-sql.ts`, `../energy/cost.ts`,
 *     `../statistics/statistics.ts`) are pure and synchronous, which is why they
 *     are unit-tested at all. Threading a promise through them would make the
 *     composition reachable only through a live query.
 *  2. There is no cache to invalidate, so there is no window in which a device
 *     re-created under the same slug is still being written under the old id.
 *  3. A missing device yields NULL, and `device_id = NULL` is false — an unknown
 *     device reads as "no data", which is what it is. The alternative (throwing)
 *     turns a stale dashboard bookmark into a 500.
 *
 * The scalar sub-selects are evaluated once per statement (an InitPlan) against
 * two tables of a handful of rows, so this costs nothing measurable on a read.
 * It is NOT the right shape for the write path: a `VALUES` list of 5 000 rows
 * would evaluate one sub-select per row on the hottest path in the app. That
 * path resolves ids in process — see `./identity.ts`.
 *
 * Pure: it composes SQL and touches no database, so every branch is unit-tested
 * (`identity-sql.test.ts`).
 */

import { type SQL, getTableName, sql } from "drizzle-orm";
import { devices, metricKeys } from "@SunReye/db/schema/plants";

/**
 * Relation names taken from the drizzle declarations, never spelled as literals.
 *
 * `apps/server/db-tests/schema-parity.test.ts` checks those declarations against
 * the live relations, so a rename in `packages/db/src/timescale/*.sql` cannot
 * leave this module addressing a table that no longer exists — which a string
 * literal silently would.
 */
const DEVICES = getTableName(devices);
const METRIC_KEYS = getTableName(metricKeys);

/**
 * The `device_id` a caller-facing source id means.
 *
 * `slug` first, `profile_id` second. The slug is the API vocabulary and the only
 * one an operator ever types. The `profile_id` arm is a TRANSITIONAL
 * compatibility arm: `?inverterId=` defaults to `profile.id` in half a dozen
 * call sites (`opts.inverterId ?? profile.id`), because in 1.x the profile id
 * *was* the stored identity — the headline bug of this release. Resolving it to
 * the device that currently runs that profile keeps those defaults working
 * WITHOUT restoring the bug: the id written into history is the device's, so a
 * profile swap now moves the lookup and leaves the history where it is.
 *
 * `min(id)` rather than a bare `select id`: `devices.slug` is unique per PLANT,
 * not globally, so a second plant could make a bare sub-select raise "more than
 * one row returned by a subquery" — at runtime, on a query that used to work.
 * `min` returns exactly one row (NULL when there are none) and is deterministic.
 * With one plant it is exact; the multi-plant read layer must pass a plant-scoped
 * device slug, which is the device-settings wave's job.
 */
export function deviceIdOf(sourceId: string): SQL {
  return sql`coalesce(
    (select min(id) from ${sql.raw(DEVICES)} where slug = ${sourceId}),
    (select min(id) from ${sql.raw(DEVICES)} where profile_id = ${sourceId})
  )`;
}

/**
 * The `metric_id` a metric key means, or NULL when the key was never registered.
 *
 * NULL is the honest answer: a key can be absent because a profile downloaded at
 * runtime declares it and no poll has written it yet, and a read of a metric with
 * no rows is empty rather than an error.
 */
export function metricIdOf(key: string): SQL {
  return sql`(select min(id) from ${sql.raw(METRIC_KEYS)} where key = ${key})`;
}

/**
 * A sub-select of the `metric_id`s a set of keys means, for `metric_id in (…)`.
 *
 * An EMPTY key list renders `where false` rather than `in ()`: an empty `IN` list
 * is a syntax error, which is the kind of failure that only shows up on the one
 * install whose profile maps none of the roles a caller asked for. Callers
 * generally return early on an empty set — this is the belt.
 */
export function metricIdsOf(keys: readonly string[]): SQL {
  if (keys.length === 0) return sql`(select id from ${sql.raw(METRIC_KEYS)} where false)`;
  const list = sql.join(
    keys.map((k) => sql`${k}`),
    sql`, `,
  );
  return sql`(select id from ${sql.raw(METRIC_KEYS)} where key in (${list}))`;
}

/**
 * `metric_id` projected back to its KEY, as the column name every caller's row
 * shape already uses (`metric`).
 *
 * A join, not an in-process map: the payload of `/api/history/recent` is keyed by
 * metric name and the shape is an external contract, so the name has to be in the
 * row. A join is also the only version that cannot go stale between the query and
 * the mapping.
 *
 * `alias` is the alias of the relation holding `metric_id`, and `as` the alias to
 * give `metric_keys` — both are internal literals, never input.
 */
export function metricKeyJoin(alias: string, as = "mk"): SQL {
  return sql`join ${sql.raw(METRIC_KEYS)} ${sql.raw(as)} on ${sql.raw(as)}.id = ${sql.raw(alias)}.metric_id`;
}

/** The projected metric-name column: `<as>.key as metric`. */
export function metricKeyColumn(as = "mk"): SQL {
  return sql`${sql.raw(as)}.key as metric`;
}
