// Shapes shared by the Integrations panel and its cards. Mirror the server's
// records — the web app cannot import from `@SunReye/db`.

/**
 * The Home Assistant EXPORT config (`packages/db/src/mqtt-config.ts`).
 *
 * Holds no broker and no secret since #217: it NAMES a `kind = 'mqtt'`
 * connection, and a null id IS "off" — there is no `enabled` flag left that
 * could disagree with it.
 */
export type MqttConfig = {
  connectionId: number | null;
  topicPrefix: string;
  haDiscoveryEnabled: boolean;
  haDiscoveryPrefix: string;
};

export type MqttStatus = {
  enabled: boolean;
  connected: boolean;
  lastError: string | null;
};

/**
 * The EVCC ingest config (`packages/db/src/evcc-config.ts`). Its OWN
 * `connectionId`: sharing the export's used to mean the ingest silently
 * followed a change to the Home Assistant broker, and that two EVCC instances
 * on two brokers were inexpressible.
 */
export type EvccConfig = {
  enabled: boolean;
  connectionId: number | null;
  topicRoot: string;
  subtractFromHome: boolean;
};
