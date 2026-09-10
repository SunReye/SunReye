/**
 * THE CONNECTION TIER — who OPENS a connection, and what a device bound to it
 * attaches to.
 *
 * `./registry.ts` resolves WHAT a device is (its roles, its metrics) and says so
 * explicitly: "it does not poll, and it does not decide the cadence — it
 * resolves WHAT a device is, never HOW it is reached". This is the other half,
 * and it exists because until #217 there was only one answer to "how": the
 * Modbus poll loop. Everything pushed — the EVCC ingest, the Home Assistant
 * export — ran its own client, dialled a broker out of `app_settings.mqtt`, and
 * had no relationship to `connections` at all.
 *
 * THE CONNECTION IS THE UNIT THAT OWNS THE CLIENT. That is the whole idea, and
 * it follows from what the row already meant (`@SunReye/db/schema/plants.ts`):
 * one gateway multiplexes many devices by unit id, and one broker carries many
 * loadpoints by index. A client per DEVICE would open N TCP connections to one
 * gateway and N subscriptions to one broker; a client per PROCESS could only
 * ever have one of each, which is the assumption this deliverable removes.
 *
 * TWO SHAPES OF TIER, and the split is `kind`:
 *
 *  - a POLL tier (`modbus`, and `http` later) asks on a cadence. `open` builds
 *    the transport; `attach` registers one device's addressing on it.
 *  - a PUSH tier (`mqtt`) is told. `open` dials and subscribes; `attach`
 *    registers one device's topic grammar.
 *
 * `attach` is per DEVICE and `open` is per CONNECTION precisely so neither tier
 * has to know how many devices it will get, and so the registry's roster stays
 * the only thing that decides which devices exist.
 *
 * WHAT IS WIRED, AND WHAT IS STILL THE POLL LOOP'S (#221)
 *
 * The PUSH tier is live: `./mqtt-tier.ts` opens a client per `kind = 'mqtt'` row
 * out of `./broker-pool.ts`, and both consumers take that client from the
 * connection instead of dialling one each — the EVCC ingest (`../evcc/evcc.ts`)
 * and the Home Assistant export (`../inverter/mqtt.ts`). That is what makes
 * {@link ConnectionStatus} answerable at all: an integration's status used to be
 * derived from its config ("a broker id is set") because nothing in the process
 * held the socket that could have been asked.
 *
 * The POLL tier is not. `../inverter/runtime.ts` still owns the Modbus
 * lifecycle: one source, re-armed on a settings save. Moving it changes when a
 * live plant stops reading its inverter, which is worth its own change (#204's
 * multi-device poll is where it lands). So `../devices/connection-runtime.ts`
 * supplies only the MQTT tier, and every `modbus` row comes back from a pass as
 * {@link TierEvents.unsupported} — reported, deliberately, rather than silently
 * treated as opened.
 *
 * WHY THE PLANNER HERE IS PURE. Every rule below is about WHICH tier gets WHICH
 * row in WHAT order — a retired device is never attached, a dangling
 * `connection_id` is reported rather than pointed at another gateway, a kind no
 * tier can open is said out loud instead of silently never polled — and each of
 * those is a way for a plant to go quiet with nothing in the log. So the
 * decisions are testable against doubles (`./connection-tier.test.ts`) and the
 * transports are injected.
 */

import { type ConnectionKind } from "@SunReye/db/connection-kinds";
import { type ConnectionRecord, type DeviceRecord, activeDevices } from "@SunReye/db/plant-repo";

/** One device, with the connection it is reached through already resolved. */
export interface BoundDevice {
  connection: ConnectionRecord;
  device: DeviceRecord;
}

/**
 * A transport for one KIND of connection.
 *
 * The tier owns its clients, keyed by connection id — which is why {@link close}
 * takes nothing: a plant with two gateways has one Modbus tier holding two
 * clients, and closing per connection would make "the tier is shut down" a state
 * no caller could express.
 */
export interface ConnectionTier {
  /** The `connections.kind` this tier is the transport for. */
  readonly kind: ConnectionKind;
  /** Build (or dial) the client for one connection. Called once per connection. */
  open(connection: ConnectionRecord): Promise<void> | void;
  /** Register one device on the client its connection opened. */
  attach(bound: BoundDevice): Promise<void> | void;
  /**
   * End of pass: these are the connections that were opened on this tier.
   *
   * Optional, and only a tier that holds its clients BETWEEN passes needs it —
   * which is every tier that reconnects, so in practice all of them. A pass
   * says what exists; without this, what has stopped existing is unsayable, and
   * a broker row the operator deleted keeps its client, its subscriptions and
   * its retry loop for the life of the process.
   *
   * Called for every supplied tier, including one that opened nothing this
   * pass: "all of my connections are gone" is exactly the case that matters.
   */
  settle?(openedConnectionIds: readonly number[]): Promise<void> | void;
  /** Release every client this tier holds. */
  close(): Promise<void> | void;
}

/**
 * What is OBSERVED of a connection right now — the answer #221 exists to make
 * possible.
 *
 * Every field is a fact about the SOCKET, never about the row: "a broker id is
 * set" is what the settings page could say before, and it stayed cheerfully true
 * through a wrong password, a renamed host and a broker that had been off for a
 * week. `lastConnectedAt` is when the endpoint was last actually seen, which is
 * the difference between "never came up" and "dropped a minute ago".
 */
export interface ConnectionStatus {
  connected: boolean;
  lastError: string | null;
  /** ISO-8601, or null when nothing has failed yet. */
  lastErrorAt: string | null;
  /** ISO-8601 of the last completed CONNECT, or null when there has been none. */
  lastConnectedAt: string | null;
}

/** A connection nothing in this build can open. */
export interface UnsupportedConnection {
  connectionId: number;
  kind: string;
}

/** An `open` or `attach` that threw, named by what it was for. */
export interface TierFailure {
  /**
   * Null when the throw was a tier-wide {@link ConnectionTier.settle} rather
   * than one connection's open or attach — a tier tidying up after a deleted
   * row belongs to no single connection.
   */
  connectionId: number | null;
  /** Present when an `attach` failed; absent when the `open` did. */
  deviceSlug?: string;
  error: string;
}

/**
 * What one pass of {@link openConnections} did, and what it could not do.
 *
 * The three lists are the reason this returns anything at all: each one is a
 * plant going partly quiet, and each was silent before — a caller that got
 * `void` back could not tell a fully-open plant from one whose only gateway
 * refused the connection.
 */
export interface TierEvents {
  /** Connections whose `kind` no supplied tier is the transport for. */
  unsupported: UnsupportedConnection[];
  /** Slugs of devices whose `connection_id` names no existing row. */
  dangling: string[];
  /** Every `open` and `attach` that threw. */
  failures: TierFailure[];
  /** Close exactly the tiers this pass opened, once each. */
  close(): Promise<void>;
}

export interface OpenConnectionsInput {
  connections: readonly ConnectionRecord[];
  devices: readonly DeviceRecord[];
  tiers: readonly ConnectionTier[];
}

/**
 * The tier for a kind, or null when this build has none.
 *
 * NULL RATHER THAN A FALLBACK. A database migrated ahead of the binary can hold
 * a kind this build does not know, and handing that row to whichever tier came
 * first would give a broker's params to the Modbus client — which then dials
 * `undefined:502` and reports a timeout, forever, for a connection that is
 * perfectly well configured.
 */
// fallow-ignore-next-line unused-export -- the null-rather-than-fallback rule, asserted directly in `./connection-tier.test.ts`; test files aren't traced as consumers.
export function tierFor(tiers: readonly ConnectionTier[], kind: string): ConnectionTier | null {
  return tiers.find((tier) => tier.kind === kind) ?? null;
}

/**
 * Tell every tier what this pass opened on it, so it can let go of the rest.
 *
 * EVERY supplied tier, not only the ones that opened something: a tier whose
 * last connection was deleted opens nothing, and it is precisely the tier that
 * has a client to release.
 */
async function settleTiers(
  tiers: readonly ConnectionTier[],
  openedOn: ReadonlyMap<number, ConnectionTier>,
  failures: TierFailure[],
): Promise<void> {
  for (const tier of tiers) {
    const ids: number[] = [];
    for (const [connectionId, on] of openedOn) if (on === tier) ids.push(connectionId);
    await guarded(failures, { connectionId: null }, () => tier.settle?.(ids));
  }
}

/** Run one call, recording a throw against the connection (and device) it was for. */
async function guarded(
  failures: TierFailure[],
  where: { connectionId: number | null; deviceSlug?: string },
  run: () => Promise<void> | void,
): Promise<void> {
  try {
    await run();
  } catch (error) {
    failures.push({ ...where, error: error instanceof Error ? error.message : String(error) });
  }
}

/**
 * Open every connection on its tier, then attach every in-service device to the
 * connection it names.
 *
 * THE ORDER IS THE CONTRACT: nothing is attached to a client that has not been
 * opened. A tier asked to attach first would have to invent a client per device,
 * which is the per-device-client shape this module exists to avoid.
 *
 * ONE FAILURE DOES NOT STOP THE PASS. An unreachable gateway must not stop the
 * broker from subscribing, and vice versa — the plant's other devices are still
 * worth reading. Every failure is collected and handed back, because a caller
 * that could not tell "open" from "open except the only inverter" would report a
 * healthy plant.
 *
 * A device with `connection_id = null` attaches to nothing and is NOT a failure:
 * `INVERTER_SIMULATE`, the optimizer, and an imported history whose hardware is
 * gone are all devices with no endpoint at all.
 */
export async function openConnections(input: OpenConnectionsInput): Promise<TierEvents> {
  const events: TierEvents = {
    unsupported: [],
    dangling: [],
    failures: [],
    close: async () => {},
  };
  const byId = new Map(input.connections.map((connection) => [connection.id, connection]));
  /** The tier each connection was opened on, so an attach reaches the same one. */
  const openedOn = new Map<number, ConnectionTier>();
  /** Tiers that actually opened something — the only ones `close` may touch. */
  const opened = new Set<ConnectionTier>();

  for (const connection of input.connections) {
    const tier = tierFor(input.tiers, connection.kind);
    if (!tier) {
      events.unsupported.push({ connectionId: connection.id, kind: connection.kind });
      continue;
    }
    openedOn.set(connection.id, tier);
    opened.add(tier);
    await guarded(events.failures, { connectionId: connection.id }, () => tier.open(connection));
  }

  // `activeDevices`, not the raw list: a retired device is out of service, and
  // attaching one polls a replaced inverter forever. Filtered here as well as in
  // SQL because this function is handed rosters it did not fetch, and two
  // spellings of "in service" is exactly how a retired device gets polled again.
  for (const device of activeDevices(input.devices)) {
    if (device.connectionId === null) continue;
    const connection = byId.get(device.connectionId);
    if (!connection) {
      // Silently pointing it at another connection would read plausible values
      // from the wrong machine, which is worse than reading none.
      events.dangling.push(device.slug);
      continue;
    }
    const tier = openedOn.get(connection.id);
    if (!tier) continue; // its connection is unsupported, and already reported
    await guarded(events.failures, { connectionId: connection.id, deviceSlug: device.slug }, () =>
      tier.attach({ connection, device }),
    );
  }

  await settleTiers(input.tiers, openedOn, events.failures);
  events.close = async () => {
    // ONCE PER TIER, not once per connection: the tier owns its clients, so two
    // gateways on one Modbus tier are one shutdown.
    for (const tier of opened) await tier.close();
  };
  return events;
}
