/**
 * THE INTEGRATIONS TAB'S RULES — which connections may be named as a broker,
 * and how the two records that name one survive a native `<select>`.
 *
 * `app_settings.mqtt` used to BE the broker: URL, username, a write-only
 * password, plus an `enabled` flag, and the EVCC ingest borrowed the whole
 * thing ("Broker parameters are deliberately absent — they come from the MQTT
 * config"). So the export and the ingest could never be on two brokers, and
 * every loadpoint device sat at `connection_id = null`. Since #217 both records
 * name a `kind = 'mqtt'` CONNECTION instead, and this module is the mapping
 * between those records and the form that edits them.
 *
 * WHY A CHOICE STRING AND NOT THE NUMBER
 *
 * The tab renders native selects (a phone in a cellar, same reason as the
 * device dialog), and a native option value is a STRING with no null in it.
 * {@link NO_BROKER} is the empty value that means "no connection", and
 * {@link brokerIdOf} is the one place a value becomes an id again — so a
 * hand-typed `Number(choice)` cannot turn the off option into connection 0.
 */

import { brokerHost } from "./devices/connection-draft";
import type { ConnectionView } from "./devices/device-types";
import type { EvccConfig, MqttConfig } from "./mqtt-types";

export type BrokerOption = { value: string; label: string };

/** The `<option>` value that means "no broker". Never a real id. */
export const NO_BROKER = "";

/**
 * The brokers a record may name: the `kind = 'mqtt'` connections, in roster
 * order, each labelled by its name and the host its URL points at.
 *
 * Empty is a state the card renders, not an error — on a fresh install there is
 * no broker yet, and the answer is a line pointing at Devices rather than a
 * select with nothing in it.
 */
export function brokerOptions(connections: readonly ConnectionView[]): BrokerOption[] {
  return connections
    .filter((c) => c.kind === "mqtt")
    .map((c) => {
      const host = brokerHost(c.params.brokerUrl);
      return { value: String(c.id), label: host === "" ? c.name : `${c.name} · ${host}` };
    });
}

/** A stored connection id as the select's value. */
function brokerChoice(connectionId: number | null): string {
  return connectionId === null ? NO_BROKER : String(connectionId);
}

/** A select value back as a connection id. Anything that is not one is "off". */
export function brokerIdOf(choice: string): number | null {
  const id = Number(choice);
  return choice !== NO_BROKER && Number.isInteger(id) && id > 0 ? id : null;
}

/** The Home Assistant export card's form state. */
export type MqttSettingsForm = {
  brokerChoice: string;
  topicPrefix: string;
  haDiscoveryEnabled: boolean;
  haDiscoveryPrefix: string;
};

export function mqttFormFrom(config: MqttConfig): MqttSettingsForm {
  return {
    brokerChoice: brokerChoice(config.connectionId),
    topicPrefix: config.topicPrefix,
    haDiscoveryEnabled: config.haDiscoveryEnabled,
    haDiscoveryPrefix: config.haDiscoveryPrefix,
  };
}

/**
 * The export config the form describes, or null while it is not sendable.
 *
 * Both prefixes are `min(1)` server-side, so a blank one is a 400 rather than a
 * default — the save button binds its `disabled` to this null instead of
 * letting the operator discover it from a toast.
 */
export function mqttConfigBody(form: MqttSettingsForm): MqttConfig | null {
  const topicPrefix = form.topicPrefix.trim();
  const haDiscoveryPrefix = form.haDiscoveryPrefix.trim();
  if (topicPrefix === "" || haDiscoveryPrefix === "") return null;
  return {
    connectionId: brokerIdOf(form.brokerChoice),
    topicPrefix,
    haDiscoveryEnabled: form.haDiscoveryEnabled,
    haDiscoveryPrefix,
  };
}

/** The EVCC card's form state — its own broker choice, not the export's. */
export type EvccSettingsForm = {
  enabled: boolean;
  brokerChoice: string;
  topicRoot: string;
  subtractFromHome: boolean;
};

export function evccFormFrom(config: EvccConfig): EvccSettingsForm {
  return {
    enabled: config.enabled,
    brokerChoice: brokerChoice(config.connectionId),
    topicRoot: config.topicRoot,
    subtractFromHome: config.subtractFromHome,
  };
}

/**
 * The EVCC config the form describes, or null while it is not sendable.
 *
 * A blank topic root blocks the save WHETHER OR NOT the ingest is enabled:
 * `topicRoot` is `min(1)` on the server, so a blank one is a 400 either way,
 * and quietly substituting the schema's default would save a topic the operator
 * never typed.
 */
export function evccConfigBody(form: EvccSettingsForm): EvccConfig | null {
  const topicRoot = form.topicRoot.trim();
  if (topicRoot === "") return null;
  return {
    enabled: form.enabled,
    connectionId: brokerIdOf(form.brokerChoice),
    topicRoot,
    subtractFromHome: form.subtractFromHome,
  };
}
