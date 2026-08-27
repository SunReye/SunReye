/**
 * The WRITE side of the identity boundary: names in, int2 ids out, resolved in
 * process and cached.
 *
 * The read side composes a scalar sub-select instead (`./identity-sql.ts`), and
 * that difference is deliberate. A read evaluates its sub-select once per
 * statement; the writer builds a `VALUES` list of up to 100 000 rows on the
 * hottest path in the app, and one sub-select per row there would be a
 * measurable cost on the very path 2.0.0 re-keyed to save bytes on.
 *
 * TWO SIDES TO METRIC REGISTRATION, AND BOTH MATTER
 *
 * `packages/inverter-core/src/schema.ts` validates a metric key as
 * `z.string().min(1)` and nothing more, and `installProfile` registers a profile
 * downloaded from a USER-SUPPLIED URL with no restart. So the metric vocabulary
 * is open at runtime, by design:
 *
 *  1. EAGER — {@link IdentityResolver.registerMetrics}, called where the runtime
 *     builds its per-profile storage policy, which already walks
 *     `profile.metrics` and is rebuilt on every profile swap. The ids therefore
 *     exist before the first poll and the steady state is a cache hit.
 *  2. LAZY — {@link IdentityResolver.metricIds}, called by the writer for the
 *     keys of the batch it is about to commit. A computed metric, a replayed
 *     capture or a profile edited under a running server produces a key the
 *     activation hook never saw, and a path that assumes registration would drop
 *     the reading — or fail the whole batch's insert on a foreign key and lose
 *     the readings that WERE known.
 *
 * Both go through `packages/db/src/metric-keys.ts`, whose `ON CONFLICT (key) DO
 * UPDATE` is what guarantees a profile reinstall REUSES rows rather than
 * renumbering: int2 caps the dimension at 32767, which is ample against ~108
 * metrics per profile only while ids never churn.
 *
 * WHAT IS AND IS NOT CACHED
 *
 * A resolved device id is cached; a MISS never is. Nothing in the codebase
 * creates a `devices` row yet — plant/device provisioning belongs to the
 * onboarding wave — so a server can boot before its device exists, and negative
 * caching would mean it writes nothing until it is restarted.
 */

import { type MetricKeySpec, ensureMetricKeys } from "@SunReye/db/metric-keys";
import { type SQL, getTableName, sql } from "drizzle-orm";
import { devices } from "@SunReye/db/schema/plants";

const DEVICES = getTableName(devices);

/**
 * The subset of a drizzle client this module needs — structural, like
 * `MetricKeyWriter`, so a test drives it against an in-memory double and a
 * database-backed test can hand it a `createDbAt` client.
 */
export interface IdentityDb {
  execute: (query: SQL) => Promise<{ rows: unknown[] }>;
}

export interface IdentityResolver {
  /** The device id a source id names, or null when no such device exists yet. */
  deviceId(sourceId: string): Promise<number | null>;
  /** Register the active profile's metrics; safe to call on every swap. */
  registerMetrics(specs: readonly MetricKeySpec[]): Promise<void>;
  /** `key -> id` for a batch's keys, registering any that are new. */
  metricIds(keys: readonly string[]): Promise<Map<string, number>>;
  /** One key's id, registering it if it is new. */
  metricId(key: string): Promise<number>;
  /** Drop every cached id. */
  reset(): void;
}

/**
 * Resolve one source id to its device id against `client`, or null.
 *
 * Mirrors `identity-sql.ts`'s `deviceIdOf` exactly — slug first, `profile_id` as
 * the transitional arm, `min(id)` because a slug is unique per PLANT rather than
 * globally — and it has to: a value resolved here and a predicate composed there
 * disagreeing would mean rows written under one id and read under another.
 *
 * Standalone (rather than only a resolver method) for the call sites that need a
 * NUMBER once, not a cache: `packages/db`'s stores are typed `deviceId: number`,
 * and a `db.insert().values()` cannot take a promise. `client` is a parameter so
 * this module still imports no database.
 */
export async function resolveDeviceId(
  client: IdentityDb,
  sourceId: string,
): Promise<number | null> {
  const result = await client.execute(sql`
    select coalesce(
      (select min(id) from ${sql.raw(DEVICES)} where slug = ${sourceId}),
      (select min(id) from ${sql.raw(DEVICES)} where profile_id = ${sourceId})
    ) as id`);
  const row = result.rows[0] as { id: number | string | null } | undefined;
  if (row?.id == null) return null;
  const id = Number(row.id);
  return Number.isFinite(id) ? id : null;
}

export interface IdentityDeps {
  db: IdentityDb;
  /** Overridable so the caching rules are testable without a database. */
  ensure?: typeof ensureMetricKeys;
}

/**
 * Build a resolver. Every cache is closure-local, so a second instance shares
 * nothing — the same rule the runtime and the storage policy follow.
 */
export function createIdentityResolver(deps: IdentityDeps): IdentityResolver {
  const ensure = deps.ensure ?? ensureMetricKeys;
  const deviceIds = new Map<string, number>();
  /** In-flight device lookups, so concurrent callers share one query. */
  const pendingDevice = new Map<string, Promise<number | null>>();
  const metricIdCache = new Map<string, number>();
  /** The counter class each cached key was registered with, so a correction re-sends. */
  const metricClass = new Map<string, boolean>();

  async function deviceId(sourceId: string): Promise<number | null> {
    // `has`, not a truthy check: id 0 cannot be issued by
    // `GENERATED ALWAYS AS IDENTITY` today, and a falsy check would make it a
    // silent data-loss bug the day something else does.
    const cached = deviceIds.get(sourceId);
    if (cached !== undefined) return cached;
    const inflight = pendingDevice.get(sourceId);
    if (inflight) return inflight;
    const query = resolveDeviceId(deps.db, sourceId)
      .then((id) => {
        // Only a HIT is cached — see the module note.
        if (id !== null) deviceIds.set(sourceId, id);
        return id;
      })
      .finally(() => pendingDevice.delete(sourceId));
    pendingDevice.set(sourceId, query);
    return query;
  }

  /** Register the specs this resolver does not already hold at that exact class. */
  async function register(specs: readonly MetricKeySpec[]): Promise<Map<string, number>> {
    const missing = specs.filter(
      (s) => !metricIdCache.has(s.key) || metricClass.get(s.key) !== s.isCounter,
    );
    if (missing.length > 0) {
      const ids = await ensure(deps.db, missing);
      for (const spec of missing) {
        const id = ids.get(spec.key);
        if (id === undefined) continue;
        metricIdCache.set(spec.key, id);
        metricClass.set(spec.key, spec.isCounter);
      }
    }
    const out = new Map<string, number>();
    for (const spec of specs) {
      const id = metricIdCache.get(spec.key);
      if (id !== undefined) out.set(spec.key, id);
    }
    return out;
  }

  return {
    deviceId,
    async registerMetrics(specs) {
      await register(specs);
    },
    metricIds(keys) {
      // `isCounter: false` for a key nobody declared: the default that cannot
      // corrupt a delta, and the eager path corrects it when the profile does
      // declare one.
      const unique = [...new Set(keys)];
      return register(unique.map((key) => ({ key, isCounter: metricClass.get(key) ?? false })));
    },
    async metricId(key) {
      const ids = await register([{ key, isCounter: metricClass.get(key) ?? false }]);
      const id = ids.get(key);
      if (id === undefined) throw new Error(`metric key ${key} could not be registered`);
      return id;
    },
    reset() {
      deviceIds.clear();
      pendingDevice.clear();
      metricIdCache.clear();
      metricClass.clear();
    },
  };
}
