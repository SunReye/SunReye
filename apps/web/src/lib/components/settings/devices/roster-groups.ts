// The roster as the page draws it: which card a device lands on, what the card
// says under its title, which devices an integration provided (and would retire),
// and which rows fold away as retired.

import * as m from "$lib/paraglide/messages";
import { transportLabel } from "../transport-label";
import { brokerHost } from "./connection-draft";
import type { ConnectionView, DeviceView, GroupedRoster, IntegrationView } from "./device-types";

/**
 * One card of the roster: a gateway and its devices, an integration and its
 * devices, the internal ones, or the devices that genuinely have no endpoint.
 *
 * `kind` is what the card renders from — a gateway is edited from its header, an
 * integration is configured elsewhere, and neither of the last two has anything
 * to edit at all.
 */
export type DeviceGroup = {
  /** Stable `{#each}` key, and the `data-connection` handle a spec addresses. */
  key: string;
  kind: "gateway" | "integration" | "internal" | "orphan";
  title: string;
  /** The words under the title — a connection's kind and address, or null. */
  caption: string | null;
  /** The gateway, on a `gateway` group; null on the other three. */
  connection: ConnectionView | null;
  /** The integration's provenance name, on an `integration` group; null otherwise. */
  integration: string | null;
  devices: DeviceView[];
  /**
   * The integration ROWS that hang off this group's endpoint — what the plant
   * runs OVER the connection, as opposed to the devices it reads THROUGH it.
   *
   * Only a `gateway` group and `internal` can carry any: a row names a
   * connection or names none, and the other two group kinds are neither. Every
   * group has the field so the card renders one shape.
   */
  integrations: IntegrationView[];
};

/**
 * A card with nothing in it — BOTH halves empty.
 *
 * Its own function because "empty" stopped being `devices.length === 0` the day
 * a card grew a second half: a broker with an EVCC ingest and no loadpoint yet
 * (its first message has not landed) would otherwise render "No devices" over
 * the top of the integration it is running.
 */
export function groupIsEmpty(group: DeviceGroup): boolean {
  return group.devices.length === 0 && group.integrations.length === 0;
}

/**
 * The display name of an integration.
 *
 * A label table, not a branch: an integration this build has no name for shows
 * as its own provenance string rather than as an empty header. (`integration`
 * is provenance and the settings UI is the sanctioned reader of it — see
 * `apps/server/src/evcc/evcc-devices.ts`.)
 */
const INTEGRATION_LABELS: Record<string, string> = {
  evcc: "EVCC",
  optimizer: "SunReye Optimizer",
};

function integrationLabel(integration: string): string {
  return INTEGRATION_LABELS[integration] ?? integration;
}

/**
 * The roster as the page shows it: one group per connection in id order, then
 * one per integration by name, then the internal devices, then the devices that
 * have no endpoint for no reason anything here can name (simulate, an imported
 * history whose hardware is gone).
 *
 * All four used to be one group. A `connectionId === null` device was an orphan
 * whatever fed it, so the EVCC loadpoint and the optimizer sat under "No
 * connection" beside a simulated inverter — three unrelated reasons told as one
 * (#213).
 *
 * A connection with no devices is a group too. It is the only kind that can be
 * deleted, and a gateway the operator cannot see is one they cannot delete. An
 * integration with no devices is not: nothing is registered under it.
 */
export function groupByConnection(roster: GroupedRoster): DeviceGroup[] {
  const rows = roster.integrations ?? [];
  const gateways: DeviceGroup[] = [...roster.connections]
    .sort((a, b) => a.id - b.id)
    .map((connection) => ({
      key: `gateway-${connection.id}`,
      kind: "gateway" as const,
      title: connection.name,
      caption: connectionCaption(connection),
      connection,
      integration: null,
      devices: roster.devices.filter((d) => d.connectionId === connection.id),
      integrations: rows.filter((i) => i.connectionId === connection.id),
    }));
  const endpointless = roster.devices.filter((d) => d.connectionId === null);
  return [
    ...gateways,
    ...integrationGroups(endpointless.filter((d) => d.kind === "coded")),
    ...loose(
      "internal",
      m.devices_group_internal(),
      endpointless.filter((d) => d.kind === "virtual"),
      rows.filter((i) => i.connectionId === null),
    ),
    ...loose(
      "orphan",
      m.devices_group_no_connection(),
      endpointless.filter((d) => d.kind === "modbus"),
      [],
    ),
  ];
}

/** One group per integration, by label, each in roster order. */
function integrationGroups(coded: readonly DeviceView[]): DeviceGroup[] {
  const byIntegration = new Map<string, DeviceView[]>();
  for (const device of coded) {
    const key = device.integration ?? "";
    byIntegration.set(key, [...(byIntegration.get(key) ?? []), device]);
  }
  return [...byIntegration.entries()]
    .map(([integration, devices]) => ({
      key: `integration-${integration}`,
      kind: "integration" as const,
      title: integrationLabel(integration),
      caption: null,
      connection: null,
      integration,
      devices,
      integrations: [],
    }))
    .sort((a, b) => a.title.localeCompare(b.title));
}

/**
 * A group that exists only while it holds something — in EITHER half.
 *
 * Internal takes the connection-less integration rows, so it can be a card with
 * no device in it at all: a coded thing running over no endpoint, configured and
 * with nowhere else on the page to be seen.
 */
function loose(
  kind: "internal" | "orphan",
  title: string,
  devices: readonly DeviceView[],
  integrations: readonly IntegrationView[],
): DeviceGroup[] {
  if (devices.length === 0 && integrations.length === 0) return [];
  return [
    {
      key: kind,
      kind,
      title,
      caption: null,
      connection: null,
      integration: null,
      devices: [...devices],
      integrations: [...integrations],
    },
  ];
}

/**
 * The `devices.profile_id` values an integration KIND provisions.
 *
 * The web half of the server's `YIELDED_PROFILES`
 * (`apps/server/src/integrations/integration-admin.ts`). A table, and only the
 * kinds that yield anything appear: the Home Assistant export publishes and
 * yields nothing, so it is absent and its confirm dialog names nothing without a
 * branch. The server is what actually retires — this exists so the dialog can
 * say what is about to happen before the operator agrees to it.
 */
const YIELDED_PROFILES: Record<string, readonly string[]> = {
  "evcc-ingest": ["evcc-loadpoint"],
};

/**
 * The IN-SERVICE devices a `DELETE /api/integrations/:id` will retire: this
 * integration's profiles, on this integration's own endpoint.
 *
 * Its own endpoint and no other's — two EVCC instances on two brokers is the
 * arrangement the connection column made expressible. Already-retired rows are
 * skipped because the server skips them too: `retired_at` is when the device
 * left service, and naming one here would promise a change that will not happen.
 */
export function retiredByRemoving(
  integration: IntegrationView,
  devices: readonly DeviceView[],
): DeviceView[] {
  return providedBy(integration, devices).filter((device) => device.retiredAt === null);
}

/**
 * The devices an integration PROVIDED: its profiles, on its own endpoint,
 * retired rows INCLUDED.
 *
 * The same rule {@link retiredByRemoving} is built on, lifted out so the card's
 * nesting and the Remove dialog's warning cannot drift apart. They differ in
 * exactly one thing, and it is not the rule: a retired loadpoint is still this
 * integration's to DRAW (a device nobody can see is a device nobody can
 * restore), and is not something a Remove will retire, because the server skips
 * a row that already left service rather than re-stamping the moment it did.
 */
export function providedBy(
  integration: IntegrationView,
  devices: readonly DeviceView[],
): DeviceView[] {
  const profiles = YIELDED_PROFILES[integration.kind] ?? [];
  return devices.filter(
    (device) =>
      device.connectionId === integration.connectionId && profiles.includes(device.profileId),
  );
}

/** An integration row together with the devices it yielded. */
export type IntegrationWithDevices = {
  integration: IntegrationView;
  devices: DeviceView[];
};

/** A card's two halves once the provided devices have moved under their provider. */
export type NestedGroup = {
  /** Read straight THROUGH the endpoint — a Modbus device on a gateway. */
  devices: DeviceView[];
  /** What RUNS over it, each owning what it provided. */
  integrations: IntegrationWithDevices[];
};

/**
 * A group's devices, redrawn under the integration that provided them.
 *
 * The complaint this answers, in the owner's words: the card listed `Carport`
 * (a loadpoint) above `EVCC` (the ingest that discovered it) as unrelated
 * siblings, with a "via MQTT" badge as the only hint that one exists BECAUSE of
 * the other. A provided device is not a sibling of its provider.
 *
 * A device is claimed by the FIRST row that can claim it and by that one only.
 * Two EVCC ingests on one broker is expressible — the catalog entry is
 * `multiInstance` — and `YIELDED_PROFILES` cannot tell their loadpoints apart,
 * since both are the same profile on the same connection. Drawing the device
 * under both would report more chargers than the plant has.
 */
export function nestIntegrations(group: DeviceGroup): NestedGroup {
  const claimed = new Set<number>();
  const integrations = group.integrations.map((integration) => {
    const devices = providedBy(integration, group.devices).filter(
      (device) => !claimed.has(device.id),
    );
    for (const device of devices) claimed.add(device.id);
    return { integration, devices };
  });
  return { devices: group.devices.filter((device) => !claimed.has(device.id)), integrations };
}

/**
 * The words under a connection's name, PER KIND (#217).
 *
 * A gateway says how it is framed, where it is and how often it is read. A
 * broker says which broker it is — it has no framing, no slave ids and no
 * cadence of its own, and rendering the Modbus caption for one produced
 * "undefined:undefined · every NaN s" the moment the second kind existed.
 */
function connectionCaption(connection: ConnectionView): string {
  if (connection.kind === "mqtt") {
    return m.devices_group_caption_mqtt({ broker: brokerHost(connection.params.brokerUrl) });
  }
  const { transport, host, port, pollIntervalMs } = connection.params;
  return m.devices_group_caption({
    transport: transportLabel(transport),
    host,
    port,
    seconds: pollIntervalMs / 1000,
  });
}

/**
 * In-service rows first, retired ones apart. A retired row stays reachable —
 * it is the only place it can be restored or deleted — but it no longer sits
 * between the devices that are working.
 */
export function splitRetired<T extends Pick<DeviceView, "retiredAt">>(
  devices: readonly T[],
): { active: T[]; retired: T[] } {
  const active: T[] = [];
  const retired: T[] = [];
  for (const device of devices) (device.retiredAt === null ? active : retired).push(device);
  return { active, retired };
}
