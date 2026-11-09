// Live frames (ADR 9): a snapshot, then deltas folded into it.

export type ByDevice = Readonly<Record<string, Readonly<Record<string, number>>>>;

/** Live values by device id, then by series name, such as `pv.mppt.power[2]`. */
export interface Values {
  readonly devices: ByDevice;
  /**
   * When each stale value, one past its gap threshold (ADR 3), was last read, in epoch
   * milliseconds; absent while none is.
   */
  readonly stale?: ByDevice;
}

/** A frame as sent: a stale value's age in seconds. */
export interface Frame {
  readonly devices: ByDevice;
  readonly stale?: ByDevice;
}

export function parseFrame(json: string): Frame | undefined {
  const value: unknown = JSON.parse(json);

  return isFrame(value) ? value : undefined;
}

function isFrame(value: unknown): value is Frame {
  return (
    value instanceof Object &&
    "devices" in value &&
    isByDevice(value.devices) &&
    (!("stale" in value) || isByDevice(value.stale))
  );
}

function isByDevice(value: unknown): value is ByDevice {
  return value instanceof Object && Object.values(value).every((series) => isSeries(series));
}

function isSeries(value: unknown): value is Readonly<Record<string, number>> {
  return value instanceof Object && Object.values(value).every((v) => Number.isFinite(v));
}

/** Epoch milliseconds by device id, then by series name. */
type Instants = Record<string, Record<string, number>>;

/** Folds `frame`, received at `now` in epoch milliseconds, into `values`: a value it sends is fresh. */
export function merge(values: Values | undefined, frame: Frame, now: number): Values {
  const changed = Object.keys(frame.devices).map(
    (device) => [device, { ...values?.devices[device], ...frame.devices[device] }] as const,
  );

  const devices = { ...values?.devices, ...Object.fromEntries(changed) };

  const stale = combine(stillStale(values?.stale ?? {}, frame), lastRead(frame.stale ?? {}, now));

  return Object.keys(stale).length > 0 ? { devices, stale } : { devices };
}

/** The stale values `frame` does not send again. */
function stillStale(stale: ByDevice, frame: Frame) {
  const kept: Instants = {};

  for (const [device, since] of Object.entries(stale)) {
    for (const [series, at] of Object.entries(since)) {
      if (frame.devices[device]?.[series] === undefined) (kept[device] ??= {})[series] = at;
    }
  }

  return kept;
}

/** When each value of `ages`, in seconds before `now`, was last read. */
function lastRead(ages: ByDevice, now: number) {
  const read: Instants = {};

  for (const [device, aged] of Object.entries(ages)) {
    for (const [series, age] of Object.entries(aged))
      (read[device] ??= {})[series] = now - age * 1000;
  }

  return read;
}

function combine(a: ByDevice, b: ByDevice): Instants {
  const devices = new Set([...Object.keys(a), ...Object.keys(b)]);

  return Object.fromEntries([...devices].map((device) => [device, { ...a[device], ...b[device] }]));
}
