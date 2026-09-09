// Shapes shared by the MQTT panel and its sub-components.

/**
 * Form shape: the password is write-only. `hasPassword` (tracked separately)
 * reflects whether one is already stored; the password field stays empty and is
 * only sent when the user types a new value.
 */
export type MqttForm = {
  enabled: boolean;
  brokerUrl: string;
  username: string;
  topicPrefix: string;
  haDiscoveryEnabled: boolean;
  haDiscoveryPrefix: string;
};

export type MqttStatus = {
  enabled: boolean;
  connected: boolean;
  lastError: string | null;
};

/** EVCC rides the same broker, so its knobs live on the MQTT page. */
export type EvccForm = {
  enabled: boolean;
  topicRoot: string;
  subtractFromHome: boolean;
};
