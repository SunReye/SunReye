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
  /** Release every client this tier holds. */
  close(): Promise<void> | void;
}

/** A connection nothing in this build can open. */
export interface UnsupportedConnection {
  connectionId: number;
  kind: string;
}

/** An `open` or `attach` that threw, named by what it was for. */
export interface TierFailure {
  connectionId: number;
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
export function tierFor(tiers: readonly ConnectionTier[], kind: string): ConnectionTier | null {
  return tiers.find((tier) => tier.kind === kind) ?? null;
}

/** Run one call, recording a throw against the connection (and device) it was for. */
async function guarded(
  failures: TierFailure[],
  where: { connectionId: number; deviceSlug?: string },
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

  events.close = async () => {
    // ONCE PER TIER, not once per connection: the tier owns its clients, so two
    // gateways on one Modbus tier are one shutdown.
    for (const tier of opened) await tier.close();
  };
  return events;
}
