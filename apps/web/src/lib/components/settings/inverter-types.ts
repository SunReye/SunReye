// Shapes shared by the inverter connection panel and its sub-components.

export type Transport = "tcp" | "rtu-over-tcp";

export type InverterConfig = {
  host: string;
  port: number;
  transport: Transport;
  unitId: number;
  timeoutMs: number;
  pollIntervalMs: number;
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
