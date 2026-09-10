/**
 * DATA ACCESS FOR `integrations` — the rows behind the EVCC ingest and the Home
 * Assistant export.
 *
 * Its own file rather than a fourth section of `./plant-repo.ts`: that module is
 * the DIMENSION SPINE (plants, connections, devices, packs), and every function
 * in it obeys one rule — ids are never reissued, because `metrics_raw.device_id`
 * is keyed to them for five years. An integration is CONFIGURATION: nothing is
 * keyed by its id, its rows are created and destroyed by an operator on a
 * settings page, and there is no `ensure*` upsert anywhere below. Filing it with
 * the spine would have put a table that may be deleted next to three that may
 * never be.
 *
 * WHAT IT SHARES WITH THE SPINE, DELIBERATELY
 *
 *  - {@link PlantDb}. The client is structural (`execute` only), so this module
 *    drags no environment into everything that imports it.
 *  - The PARSE-ON-READ rule. {@link toIntegration} runs `parseIntegrationParams`
 *    and THROWS on a kind this build has no arm for, exactly as `toConnection`
 *    does. A database migrated ahead of the binary is loud here rather than
 *    yielding an integration nothing starts — never subscribed, never published,
 *    with no error anyone reads. See `./integrations.ts` on why a ROW must not
 *    take the silent-default treatment `app_settings` gets.
 *  - "The right SQL is sometimes NO SQL": an empty patch runs no UPDATE, because
 *    `update integrations set where id = 1` is a syntax error.
 *
 * Proved twice, and it has to be: `./integrations-store.test.ts` covers the
 * mapping either side of each statement, and
 * `apps/server/db-tests/integrations-store.test.ts` EXECUTES every one of them
 * against a real Postgres — the partial unique index, the `ON DELETE RESTRICT`
 * on the connection and the `::jsonb` cast are engine behaviour that no
 * SQL-text assertion can prove.
 */

import { type SQL, sql } from "drizzle-orm";

import { type IntegrationParams, parseIntegrationParams } from "./integrations";
import type { PlantDb } from "./plant-repo";

/**
 * One integration row as the readers want it: its identity, its endpoint, and
 * its `kind`/`params` pair already narrowed to the arm they belong to.
 *
 * An intersection with the discriminated union rather than a `params: unknown`
 * bag, so a reader that has checked `kind` gets the parsed shape and cannot ask
 * an export for a topic root.
 */
export type IntegrationRecord = {
  id: number;
  /** The endpoint it runs over, or null for a connection-less kind. */
  connectionId: number | null;
  /** The off switch for a CONFIGURED integration; absence is "not configured". */
  enabled: boolean;
} & IntegrationParams;

/** Everything an insert states. `enabled` is not among them: a new row runs. */
export type IntegrationSpec = { connectionId: number | null } & IntegrationParams;

/**
 * What may change on an existing integration.
 *
 * `kind` and `connectionId` are absent, and that is a rule rather than an
 * omission — they are the row's IDENTITY. Re-kinding a row in place would leave
 * the devices it yielded (an EVCC loadpoint carries its topic root) provisioned
 * by code that no longer runs, and re-pointing it would move a subscription off
 * the broker its loadpoints are bound to. A different pairing is a different
 * integration; the service refuses the patch
 * (`apps/server/src/integrations/integration-admin.ts`).
 *
 * `params` is therefore WHOLE, not per-field: it is the row's own kind's shape,
 * already validated by the caller against that kind.
 */
export interface IntegrationPatch {
  enabled?: boolean;
  params?: IntegrationParams["params"];
}

const INTEGRATION_COLUMNS = sql`id, connection_id as "connectionId", kind, enabled, params`;

/** A smallint arrives as a STRING through this driver; a null stays a null. */
const maybeInt = (value: unknown): number | null => (value === null ? null : Number(value));

/** A row, with its params validated against its own `kind`. THROWS — see the header. */
function toIntegration(row: Record<string, unknown>): IntegrationRecord {
  return {
    id: Number(row.id),
    connectionId: maybeInt(row.connectionId ?? null),
    enabled: row.enabled === true,
    ...parseIntegrationParams(row.kind, row.params),
  };
}

/** Every integration of the plant, lowest id first. */
export async function readIntegrations(db: PlantDb, plantId: number): Promise<IntegrationRecord[]> {
  const { rows } = await db.execute(
    sql`select ${INTEGRATION_COLUMNS} from integrations
        where plant_id = ${plantId} order by id asc`,
  );
  return (rows as Record<string, unknown>[]).map(toIntegration);
}

/**
 * Configure an integration — always an INSERT.
 *
 * There is no `ensure` counterpart on purpose: a row's PRESENCE is what "this
 * plant runs an EVCC ingest" means, so a second call is a second integration
 * (two EVCC instances on one broker under two topic roots is a supported
 * shape), not the same one again. The one arrangement that must NOT repeat —
 * an `ha-export` per connection — is refused by the partial unique index, which
 * is where a rule about two rows belongs.
 */
export async function createIntegration(
  db: PlantDb,
  plantId: number,
  spec: IntegrationSpec,
): Promise<IntegrationRecord> {
  const { rows } = await db.execute(sql`
    insert into integrations (plant_id, connection_id, kind, params)
    values (${plantId}, ${spec.connectionId}, ${spec.kind},
            ${JSON.stringify(spec.params)}::jsonb)
    returning ${INTEGRATION_COLUMNS}`);
  const row = rows[0] as Record<string, unknown> | undefined;
  if (!row) throw new Error(`integration for plant ${plantId} could not be created`);
  return toIntegration(row);
}

/**
 * Toggle an integration or replace its settings, then read it back.
 *
 * No UPDATE at all when nothing was named — `set` with no assignments is a
 * syntax error, and an empty patch is a read. `updated_at` rides along with any
 * assignment, because "when did the export stop publishing" is the question the
 * column exists for.
 */
export async function updateIntegration(
  db: PlantDb,
  id: number,
  patch: IntegrationPatch,
): Promise<IntegrationRecord> {
  const assignments: SQL[] = [];
  if (patch.enabled !== undefined) assignments.push(sql`enabled = ${patch.enabled}`);
  if (patch.params !== undefined) {
    assignments.push(sql`params = ${JSON.stringify(patch.params)}::jsonb`);
  }
  if (assignments.length > 0) {
    assignments.push(sql`updated_at = now()`);
    await db.execute(
      sql`update integrations set ${sql.join(assignments, sql`, `)} where id = ${id}`,
    );
  }
  const { rows } = await db.execute(
    sql`select ${INTEGRATION_COLUMNS} from integrations where id = ${id}`,
  );
  const row = rows[0] as Record<string, unknown> | undefined;
  if (!row) throw new Error(`integration ${id} does not exist`);
  return toIntegration(row);
}

/**
 * Un-configure an integration. True when a row went, false when there was none.
 *
 * Nothing cascades — and nothing can: the devices an integration YIELDED
 * (`devices.connection_id` names the broker, never this row) are not referenced
 * here at all, which is exactly why the caller retires them rather than letting
 * the engine take them. Their readings are keyed to their `devices.id` in
 * `metrics_raw`, and a delete would take five years of history with it.
 */
export async function deleteIntegration(db: PlantDb, id: number): Promise<boolean> {
  const { rows } = await db.execute(sql`delete from integrations where id = ${id} returning id`);
  return rows.length > 0;
}
