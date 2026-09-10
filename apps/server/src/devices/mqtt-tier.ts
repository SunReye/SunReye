/**
 * THE PUSH TIER — `kind = 'mqtt'` rows, one client each, out of
 * `./broker-pool.ts`.
 *
 * The tier is the LIFECYCLE and the pool is the client: a pass of
 * `./connection-tier.ts`'s `openConnections` says which broker rows the plant
 * has right now, and this turns that into "open the new ones, re-open the edited
 * ones, hold the unchanged ones, release the deleted ones". Consumers — the EVCC
 * ingest, the Home Assistant export — acquire from the same pool and therefore
 * get the SAME client; none of them owns its lifetime, which is what makes an
 * integration's status a fact about a socket rather than a fact about a config.
 *
 * WHY THE TIER HOLDS A LINK OF ITS OWN, even for a broker no integration uses:
 * the connection is the unit that owns the client, so `connections` is what
 * decides whether one is open. An operator who adds a broker and has not yet
 * added an integration on it can still be told, on the same page, whether the
 * address they typed answers.
 *
 * WHY `attach` DOES NOTHING. A pushed device is not addressed the way a polled
 * one is: an EVCC loadpoint's "addressing" is its index inside a topic tree the
 * INGEST subscribes to once per connection (`../evcc/evcc.ts`), not a unit id
 * this tier could register on a client. Attaching per device would be a second
 * subscription per loadpoint to the same tree. It stays on the interface because
 * the poll tier genuinely needs it — see `./connection-tier.ts`.
 */

import type { BrokerLink, BrokerPool } from "./broker-pool";
import type { ConnectionTier } from "./connection-tier";

export function createMqttTier(pool: BrokerPool): ConnectionTier {
  /** One link per connection id — never two, or a release can never close. */
  const links = new Map<number, BrokerLink>();

  async function releaseLink(connectionId: number): Promise<void> {
    const link = links.get(connectionId);
    if (!link) return;
    links.delete(connectionId);
    await link.release();
  }

  return {
    kind: "mqtt",
    async open(connection) {
      // The union is discriminated on `kind`, and the planner only ever hands
      // this tier its own; the guard is what narrows `params` to a broker's.
      if (connection.kind !== "mqtt") return;
      const held = links.get(connection.id);
      // ONE HOLDER PER ROW, for the life of the row. Re-acquiring per pass would
      // leak a holder per settings save and the client could then never close;
      // the pool decides whether the row's params changed enough to re-dial.
      if (held) held.update(connection.params);
      else links.set(connection.id, pool.acquire(connection.id, connection.params));
    },
    attach() {},
    async settle(openedConnectionIds) {
      // A COPY of the keys: `releaseLink` deletes from the map below it.
      for (const connectionId of Array.from(links.keys())) {
        if (!openedConnectionIds.includes(connectionId)) await releaseLink(connectionId);
      }
    },
    async close() {
      for (const connectionId of Array.from(links.keys())) await releaseLink(connectionId);
    },
  };
}
