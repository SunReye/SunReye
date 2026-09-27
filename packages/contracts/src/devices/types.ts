/**
 * The device roster's wire shapes: devices, the connections they are reached
 * through, and the integrations that run over those connections.
 *
 * These are the definition site — `device-admin.ts` and `integration-admin.ts`
 * on the server build rows of them, and the web settings panel, the add wizard
 * and the browser fixtures import them from `@SunReye/contracts/devices`. The
 * web app used to restate every one of them ("Mirrors the server's DeviceView"),
 * which is a comment, not a check.
 */

import type { DeviceBattery } from "@SunReye/db/batteries";
import type {
  ConnectionKind as DbConnectionKind,
  ConnectionParamsMasked,
} from "@SunReye/db/connection-kinds";
import type { DeviceRecord } from "@SunReye/db/plant-repo";

/**
 * Every connection kind this build can open. The list itself stays a value of
 * `@SunReye/db/connection-kinds` — its CHECK constraint is what decides.
 */
export type ConnectionKind = DbConnectionKind;

/**
 * A connection AS THE API RETURNS IT — every write-only field stripped
 * (`maskConnectionParams`). Discriminated on `kind`: the two arms share not one
 * field, and every reader switches on it.
 */
export type ConnectionView = { id: number; name: string } & ConnectionParamsMasked;

/**
 * How a device is fed. NOT a capability and not a branch anything downstream
 * takes: it is what the roster has to say out loud, because the three are
 * indistinguishable on a row that only knows "polled: false".
 */
export type DeviceKind = "modbus" | "coded" | "virtual";

/**
 * What the roster reports about a device, one word per reason it is not being
 * read. Replaces a `polled` boolean, which reported an MQTT-fed loadpoint and a
 * computation as broken Modbus hardware (#213).
 *
 * `polling` is the one device the loop reads today; #204 extends it to many and
 * does not change this enum.
 *
 * `provided` was called `integration` until integrations became ROWS of their
 * own. One list then held both — a loadpoint badged "integration", and a few
 * lines above it the EVCC ingest that provides it — so the state says what is
 * true of the DEVICE: something else provides its readings.
 */
export type DeviceState = "polling" | "idle" | "provided" | "virtual" | "retired";

/**
 * A device as the settings page shows it: the row, its endpoint, and the facts
 * the row alone cannot answer.
 *
 * `retiredAt` is an ISO string rather than a `Date` because this shape crosses
 * the HTTP edge; the repository's `Date` would arrive as a string anyway.
 */
export interface DeviceView extends Omit<DeviceRecord, "retiredAt"> {
  /** ISO timestamp while retired, null in service. */
  retiredAt: string | null;
  connection: ConnectionView | null;
  /** The pack this inverter carries, or null — every other role has none. */
  battery: DeviceBattery | null;
  profileName: string | null;
  /** Whether the name above resolved — an installed profile, or a coded declaration. */
  profileKnown: boolean;
  /** How this device is fed. */
  kind: DeviceKind;
  /** Why it is, or is not, being read. */
  state: DeviceState;
  /** The integration a coded device belongs to (`evcc`), or null. Provenance only. */
  integration: string | null;
}

/** `GET /api/devices`. */
export interface DeviceRoster {
  devices: DeviceView[];
  connections: ConnectionView[];
}

/**
 * What is OBSERVED of a connection right now (#221). Every field is a fact about
 * the SOCKET, never about the row. `lastConnectedAt: null` splits the shut case
 * into "dropped" and "never once opened".
 */
export interface ConnectionStatus {
  connected: boolean;
  lastError: string | null;
  /** ISO-8601, or null when nothing has failed yet. */
  lastErrorAt: string | null;
  /** ISO-8601 of the last completed CONNECT, or null when there has been none. */
  lastConnectedAt: string | null;
}

/**
 * An integration as `/api/integrations` returns it.
 *
 * `label`, `addable` and `multiInstance` are DERIVED per response from the
 * catalog entry the row's kind resolves to — not stored, so a build that renames
 * "EVCC" is not contradicted by every row written before it.
 */
export interface IntegrationView {
  id: number;
  kind: string;
  /** The endpoint it runs over, or null for a coded thing that needs none. */
  connectionId: number | null;
  enabled: boolean;
  params: Record<string, unknown>;
  /** From the catalog entry; falls back to the raw kind when this build has none. */
  label: string;
  addable: boolean;
  multiInstance: boolean;
  /**
   * Live socket health, or null when nothing in this process holds a client for
   * it. NULL IS NOT "DOWN" — it is "not known here".
   */
  status: ConnectionStatus | null;
}

/** `GET /api/integrations`. */
export interface IntegrationList {
  integrations: IntegrationView[];
}
