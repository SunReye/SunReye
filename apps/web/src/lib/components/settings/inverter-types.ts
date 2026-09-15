// Shapes shared by the inverter connection panel and its sub-components.

/**
 * How Modbus is framed on the wire.
 *
 * `solarman-v5` is not a Modbus framing in the same sense as the other two: it
 * is the vendor envelope the Solarman/IGEN WiFi logger stick wraps a Modbus PDU
 * in, on port 8899 rather than 502 and addressed by the stick's own serial
 * number. It is here because it is picked in the same select — that stick ships
 * in the box with most Deye and Sunsynk hybrids, so for a large share of
 * installs it is the ONLY way to reach the inverter at all.
 *
 * The web app cannot import `@SunReye/db`, so this restates the server's union
 * and the CHECK constraint there is what decides.
 */
export type Transport = "tcp" | "rtu-over-tcp" | "solarman-v5";

export type InverterConfig = {
  host: string;
  port: number;
  transport: Transport;
  unitId: number;
  timeoutMs: number;
  pollIntervalMs: number;
  /**
   * The Solarman stick's own serial, when one is configured. Optional because
   * the port discovers it from the stick's own reply — see `inverterConfigSchema`
   * in `@SunReye/db/inverter-config`, which this restates.
   */
  loggerSerial?: number;
  /**
   * Read a fake inverter instead of the address above. Part of the SAVED config
   * since it stopped being env-only, and bound by `inverter-simulate-switch.svelte`
   * — which svelte-check refused on every build while this type omitted it.
   */
  simulate: boolean;
};

export type InverterStatus = {
  connected: boolean;
  simulate: boolean;
  lastError: string | null;
  lastSampleAt: string | null;
  profile: string;
};

/** One metric captured by a test read, as listed in the snapshot dialog. */
export type SnapshotMetric = {
  key: string;
  label: string;
  unit: string | null;
  group: string;
  value: number;
  display?: string;
};

/** Outcome of a test read: an error, or the captured snapshot. */
export type TestResult = {
  ok: boolean;
  error?: string;
  metricCount?: number;
  durationMs?: number;
  metrics?: SnapshotMetric[];
};
