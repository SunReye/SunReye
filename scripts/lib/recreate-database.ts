/**
 * DROP and CREATE one database through a maintenance connection.
 *
 * Shared by `scripts/archive-round-trip.ts` and `scripts/replay-rehearsal.ts`:
 * both recreate their 2.0.0 target so that a re-run is a reset, and both wrote
 * the same drop/create/close block for it.
 *
 * The connection is the CALLER'S, opened and handed in, because which pool to
 * open is not the same decision in the two scripts — the rehearsal opens this
 * one through `connectBriefly` (an idle maintenance connection is what makes the
 * next run's DROP hang) while the round trip has only one kind of pool. What is
 * shared is the pair of statements and the guarantee that the connection is
 * closed afterwards, including when the DROP fails.
 *
 * `WITH (FORCE)` because a target that some previous run left a session on
 * cannot be dropped otherwise, and refusing is the same as failing.
 *
 * The caller must have decided already that this database MAY be destroyed —
 * `assertRoundTripTarget` / `assertRehearsalTarget` are what stand between this
 * and a database shared with a live inverter. Nothing here checks that.
 */

/** A pool one maintenance statement can run on, and that the callee closes. */
export interface AdminSql {
  unsafe(query: string, values?: unknown[]): Promise<unknown>;
  end(): Promise<void>;
}

/**
 * Drop `database` if it exists and create it empty, then close `admin`.
 *
 * `database` is interpolated into the statement: it is a name this repo's own
 * scripts computed, never anything a request carried.
 */
export async function recreateDatabase(admin: AdminSql, database: string): Promise<void> {
  try {
    await admin.unsafe(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${database}`);
  } finally {
    await admin.end();
  }
}
