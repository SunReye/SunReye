// Live frames (ADR 9): a snapshot, then deltas folded into it.

/** Live values by device id, then by series name, such as `pv.mppt.power[2]`. */
export interface Values {
  readonly devices: Readonly<Record<string, Readonly<Record<string, number>>>>;
}

export function parseFrame(json: string): Values | undefined {
  const value: unknown = JSON.parse(json);

  return isFrame(value) ? value : undefined;
}

function isFrame(value: unknown): value is Values {
  return (
    value instanceof Object &&
    "devices" in value &&
    value.devices instanceof Object &&
    Object.values(value.devices).every((series) => isSeries(series))
  );
}

function isSeries(value: unknown): value is Readonly<Record<string, number>> {
  return value instanceof Object && Object.values(value).every((v) => Number.isFinite(v));
}

export function merge(values: Values | undefined, delta: Values): Values {
  const changed = Object.keys(delta.devices).map(
    (device) => [device, { ...values?.devices[device], ...delta.devices[device] }] as const,
  );

  return { devices: { ...values?.devices, ...Object.fromEntries(changed) } };
}
