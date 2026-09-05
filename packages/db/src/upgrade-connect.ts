/**
 * A DEDICATED connection for the resumable backfill.
 *
 * Not the shared `./index.ts` client, and this is a correctness requirement
 * rather than a tidiness one. That client is a drizzle `Pool`, so consecutive
 * `query` calls may land on DIFFERENT backends — and every unit of work in
 * `./backfill-run.ts` is one explicit `begin` / `commit` around a chunk plus its
 * `replay_progress` row. Split across two connections, the `begin` opens a
 * transaction nothing else joins, the chunk commits outside it and the watermark
 * commits separately: the exact "a killed chunk rolls back whole" guarantee the
 * whole design rests on, silently gone.
 *
 * It is also long-lived work (measured: 170.8 s for 5.7M replayed rows) and would
 * hold a pooled connection out of the dashboard's pool for the duration.
 */
import { Client } from "pg";

import { type UpgradeClient, pgUpgradeClient } from "./upgrade-120-run";

/** The connection this module needs — `pg.Client`'s three relevant methods. */
export interface UpgradeConnection {
  connect(): Promise<void>;
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
  end(): Promise<void>;
}

/** The real thing. A parameter with a default so the rule below is testable. */
const pgConnection = (databaseUrl: string): UpgradeConnection =>
  new Client({ connectionString: databaseUrl }) as unknown as UpgradeConnection;

/**
 * Run `fn` against a connection of its own, closing it whatever happens.
 *
 * `end()` in a `finally` INSIDE the try that follows `connect()`, and the two
 * halves are ordered deliberately: the caller is a fire-and-forget background
 * task, so a rejection has no handler of its own, and a leaked socket per failed
 * attempt exhausts `max_connections` on the box the inverter is also talking to.
 * A connect that FAILED has nothing to close, so it must not be inside the
 * `finally` either — `end()` on a client that never connected is its own error,
 * thrown from a `finally`, which would replace the real cause.
 *
 * `connect` is injectable so all three of those paths can be proved without a
 * Postgres; production never passes it.
 */
export async function withUpgradeClient<T>(
  databaseUrl: string,
  fn: (client: UpgradeClient) => Promise<T>,
  connect: (databaseUrl: string) => UpgradeConnection = pgConnection,
): Promise<T> {
  const client = connect(databaseUrl);
  await client.connect();
  try {
    return await fn(pgUpgradeClient(client as never));
  } finally {
    await client.end();
  }
}
