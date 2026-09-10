/**
 * What an integration's own page shows, decided here.
 *
 * The devices page answers WHY IS NOTHING ARRIVING — a connection is the thing
 * that fails, so that page groups by connection and always will. This one
 * answers the other real question, the one the owner asked ("why is it not like
 * in Home Assistant, where you click into EVCC and see all the loadpoints and
 * roles and data"): WHAT IS THIS INTEGRATION GIVING ME. Neither collapses into
 * the other.
 *
 * Everything that can be wrong is a function here rather than a branch in the
 * page: how a live status reads when it has never connected, when it has failed,
 * and when nothing in this process is holding a client for it at all; how a
 * device says where it is addressed, when three device kinds are addressed in
 * three different ways; and which live values the integration can honestly
 * claim. Runes do not run under `bun test` (`apps/web/TESTING.md`), so a
 * decision left inside the component is a decision nothing checks.
 */

import type { LiveValueId } from "$lib/live/ownership";
import * as m from "$lib/paraglide/messages";
import type { DeviceView, IntegrationView } from "../devices/device-types";

/**
 * The integration's live status, as the page renders it.
 *
 * `IntegrationView.status` is OBSERVED from the broker pool, not derived from
 * the config row — the pre-#221 status was "a broker id is set", which is a
 * statement about the settings and not about the socket. So this reports what
 * was observed and, when nothing was, says exactly that.
 */
export type IntegrationStatusView = {
  /** Painted healthy. True only for an observed, currently-open connection. */
  ok: boolean;
  /** The one line the badge carries. */
  label: string;
  /**
   * False when `status` is null: nothing in this process holds a client for the
   * row. NOT "down" — an integration on no connection at all, a `modbus` row
   * the poll loop still owns, or a boot that has opened nothing yet. A page
   * that painted this red would be inventing a measurement, which is worse than
   * the config-derived status it replaced because it looks like one.
   */
  observed: boolean;
  /** ISO of the last completed connect, or null — including "never". */
  lastConnectedAt: string | null;
  /** The last failure and when, or null on both when nothing has failed. */
  lastError: string | null;
  lastErrorAt: string | null;
};

export function integrationStatus(integration: IntegrationView): IntegrationStatusView {
  const status = integration.status;
  if (!status) {
    return {
      ok: false,
      label: m.integration_status_unobserved(),
      observed: false,
      lastConnectedAt: null,
      lastError: null,
      lastErrorAt: null,
    };
  }
  return {
    ok: status.connected,
    label: statusLabel(status.connected, status.lastConnectedAt),
    observed: true,
    lastConnectedAt: status.lastConnectedAt,
    lastError: status.lastError,
    lastErrorAt: status.lastErrorAt,
  };
}

/**
 * "Never connected" is its own answer, not a quieter "Not connected".
 *
 * They are different faults with different fixes: one is a broker that has gone
 * away, the other is a broker that was never reachable with these credentials,
 * and an operator told the wrong one looks in the wrong place.
 */
function statusLabel(connected: boolean, lastConnectedAt: string | null): string {
  if (connected) return m.integration_status_connected();
  return lastConnectedAt === null
    ? m.integration_status_never()
    : m.integration_status_disconnected();
}

/** One of the plant's integrations by its route parameter, or null. */
export function findIntegration(
  rows: readonly IntegrationView[],
  id: string | undefined,
): IntegrationView | null {
  const wanted = Number(id);
  if (!Number.isInteger(wanted)) return null;
  return rows.find((row) => row.id === wanted) ?? null;
}

/**
 * How a device is ADDRESSED — the question the row's identifiers were failing
 * to answer on the devices page.
 *
 * Three kinds, three genuinely different answers. A `modbus` device has a slave
 * id on a wire. A `coded` one has an index in the integration's own config (an
 * EVCC loadpoint's position), which is not a slave id and must not wear the
 * same word. A `virtual` one is addressed by nothing at all: it is this
 * server's own computation.
 */
export function deviceAddress(device: DeviceView): string {
  switch (device.kind) {
    case "modbus":
      return m.devices_unit({ id: device.unitId });
    case "coded":
      return m.integration_address_index({ id: device.unitId });
    default:
      return m.integration_address_internal();
  }
}

/** One live value an integration can honestly claim, with its label and unit. */
export type IntegrationReading = {
  id: LiveValueId;
  label: () => string;
  unit: string;
};

/**
 * The live values an integration KIND produces, under `$lib/live/ownership.ts`.
 *
 * A table, and a deliberately short one. Ownership names plant-wide ids only —
 * `evcc.charge.power` is every loadpoint's power summed — so there is no id for
 * "Carport's power" to read, and inventing one by reaching into the EVCC store
 * behind `livePlant` is precisely the cross-topic merge `ownership.ts` exists to
 * forbid. So the readings belong to the INTEGRATION and are labelled as such;
 * the device rows carry role and addressing and no number they cannot own.
 *
 * A kind with no entry reports nothing rather than an empty tile.
 */
const INTEGRATION_READINGS: Record<string, readonly IntegrationReading[]> = {
  "evcc-ingest": [{ id: "evcc.charge.power", label: m.integration_live_charge_power, unit: "W" }],
};

export function integrationReadings(integration: IntegrationView): readonly IntegrationReading[] {
  return INTEGRATION_READINGS[integration.kind] ?? [];
}
