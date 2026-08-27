/**
 * The write path's identity boundary: one batch of {@link StorageRow}s — which
 * carry NAMES — becomes one batch of rows carrying the int2 identity
 * `metrics_raw` and `metrics_config_log` are keyed by.
 *
 * WHY IT IS HERE AND NOT IN THE POLICY
 *
 * `./storage-policy.ts` is pure and SYNCHRONOUS, which is the only reason it can
 * be tested without a poll loop, a transport or a database. Resolving an id needs
 * a query, so the resolution happens AROUND it: the policy keeps routing by
 * `(inverterId, metric)` in memory, and the translation happens where the rows
 * leave the process — the two `createHistoryBuffer` commits in `./runtime.ts`,
 * which are the only INSERTs into either table.
 *
 * WHY A DROPPED ROW RATHER THAN A FAILED BATCH
 *
 * `device_id` is `NOT NULL` with a real foreign key (`ON DELETE RESTRICT`), so a
 * row naming a device that does not exist does not become a NULL — it takes the
 * WHOLE batch's INSERT down with it, losing up to 100 000 buffered rows that were
 * perfectly resolvable. And a device may legitimately not exist yet: nothing in
 * the codebase creates a `devices` row today (plant/device provisioning belongs
 * to the onboarding wave), so a server can boot and flush before its device row
 * is there.
 *
 * So an unresolvable source drops its own rows and says so — once per source, or
 * a 1 Hz poll loop turns the log into the failure. It says so AGAIN if a source
 * that used to resolve stops resolving, because that is a device removed under a
 * running server, and silence there would hide data loss.
 */

import type { MetricRow } from "./history-buffer";
import type { StorageRow } from "./storage-policy";
import type { IdentityResolver } from "../shared/identity";

/** The one failure path this logs; kept minimal so any logger satisfies it. */
export interface IdentityLogger {
  warn(template: string, values?: Record<string, unknown>): void;
}

export interface RowIdentifierDeps {
  /** Only the two resolutions are needed, so only those are asked for. */
  resolver: Pick<IdentityResolver, "deviceId" | "metricIds">;
  logger: IdentityLogger;
}

export interface RowIdentifier {
  /** Resolve one batch, dropping the rows whose device does not exist. */
  identify(rows: readonly StorageRow[]): Promise<MetricRow[]>;
}

/**
 * Build an identifier. The "already warned" set is closure-local, so a second
 * instance shares nothing — the same rule the runtime and the storage policy
 * follow.
 */
export function createRowIdentifier(deps: RowIdentifierDeps): RowIdentifier {
  /** Sources already warned about, so the warning is once and not once a second. */
  const warned = new Set<string>();

  async function identify(rows: readonly StorageRow[]): Promise<MetricRow[]> {
    // An empty batch resolves nothing: `ensureMetricKeys` on an empty spec list
    // would be a `VALUES` list with no rows (a syntax error), and a lookup for a
    // source nobody named is a wasted round trip on the flush path.
    if (rows.length === 0) return [];

    const sources = [...new Set(rows.map((r) => r.inverterId))];
    const deviceIds = new Map<string, number>();
    await Promise.all(
      sources.map(async (source) => {
        const id = await deps.resolver.deviceId(source);
        if (id !== null) {
          deviceIds.set(source, id);
          // Cleared on success, so a device removed later warns again.
          warned.delete(source);
          return;
        }
        if (warned.has(source)) return;
        warned.add(source);
        deps.logger.warn(
          "no device row names {source}; its readings are not being stored. Onboarding must create the plant's device.",
          { source },
        );
      }),
    );

    // One registration for the whole batch, deduplicated: a round trip per key
    // would be the write path this release re-keyed to make cheaper.
    const metricIds = await deps.resolver.metricIds([...new Set(rows.map((r) => r.metric))]);

    const out: MetricRow[] = [];
    for (const r of rows) {
      const deviceId = deviceIds.get(r.inverterId);
      const metricId = metricIds.get(r.metric);
      if (deviceId === undefined || metricId === undefined) continue;
      // `durMs` is spread in only when the row HAS one: absent means "no duration
      // was recorded", which is not a duration and must not be spelled as one.
      out.push({
        time: r.time,
        deviceId,
        metricId,
        value: r.value,
        ...(r.durMs === undefined ? {} : { durMs: r.durMs }),
      });
    }
    return out;
  }

  return { identify };
}

/**
 * The commit the runtime hands each history buffer: resolve the batch's identity,
 * then insert what resolved.
 *
 * Extracted rather than written inline in `./runtime.ts` because it holds the one
 * branch that matters and could not be reached from there: the runtime's own suite
 * injects both buffers, so a commit built inside `createRuntime` is never called.
 *
 * `INSERT ... VALUES` with no values is a syntax error, and a batch every row of
 * which named an unknown device resolves to nothing — so the empty case must be a
 * no-op rather than a statement.
 */
export function createIdentifiedCommit(deps: {
  identify: RowIdentifier["identify"];
  insert: (rows: MetricRow[]) => Promise<unknown>;
}): (rows: StorageRow[]) => Promise<void> {
  return async (rows) => {
    const values = await deps.identify(rows);
    if (values.length === 0) return;
    await deps.insert(values);
  };
}
