/**
 * Compat layer types shared by every inverter profile.
 *
 * A profile is a data-only description of an inverter's Modbus map plus an
 * optional simulation hook. No profile ships in the core; they are authored with
 * `@sunreye/profile-sdk`, published to a git repo (the official one is a baked-in
 * default source), and downloaded into the runtime registry — so new inverters
 * are added without touching the core engine.
 */

import type { ComputeExpr, ControlExpr } from "./profile-data";
import type { CanonicalRole } from "./roles";

/**
 * Modbus register encodings we support.
 *
 * - `U_WORD`   unsigned 16-bit, one register.
 * - `S_WORD`   signed 16-bit (two's complement), one register.
 * - `U_DWORD`  unsigned 32-bit across two registers, low word first
 *              (`addresses = [low, high]`), matching the "U_DWORD (LW,HW)"
 *              layout in the vendor docs.
 * - `RAW`      opaque multi-register value (e.g. packed system time). Not
 *              part of the numeric sample; carried in the catalog only.
 */
export type RegisterType = "U_WORD" | "S_WORD" | "U_DWORD" | "RAW";

/** Read-only vs. read/write (settings) register. */
export type MetricAccess = "r" | "rw";

/** One decoded/normalized value keyed by its canonical metric key. */
export type MetricValues = Record<string, number>;

/**
 * How a metric should be *treated* by consumers (drives widget choice in the
 * UI), independent of any specific inverter.
 *
 * - `measurement`  instantaneous scalar (power, voltage, current, SoC, temp).
 * - `cumulative`   monotonic energy counter (kWh) — show today/total + deltas.
 * - `status`       enum / flag; render a label from {@link MetricDef.enumLabels}.
 * - `setting`      writable configuration; render a control.
 */
export type MetricKind = "measurement" | "cumulative" | "status" | "setting";

/**
 * Where a metric's values are persisted — a *storage* statement, deliberately
 * not a rendering one. {@link MetricKind} drives widget choice, so deriving
 * retention from it alone would couple what is kept to how it is drawn; this is
 * the field an author overrides when the derivation is wrong for their device.
 *
 * - `series`  change-only rows into the `metrics_raw` hypertable.
 * - `config`  a change-log, never `metrics_raw`: an enum, a schedule slot or a
 *             current limit has no meaningful time-weighted mean, so the
 *             timeseries policies (rollups, retention) buy nothing.
 * - `none`    live feed only, never persisted.
 *
 * Absent ⇒ derived from {@link resolveKind}; see `resolveStorage`.
 */
export type MetricStorage = "series" | "config" | "none";

/**
 * Canonical, inverter-agnostic concept a metric represents. This is the stable
 * vocabulary the UI renders against; adapters map device-specific metrics onto
 * these roles so the UI never hard-codes vendor keys. Indexed concepts
 * (strings, phases) carry the position in {@link MetricDef.index}.
 *
 * Defined by (and derived from) the {@link ROLE_CATALOG} in `./roles`, which
 * also records each role's expected shape (indexed / writable / enum / signed).
 */
export type { CanonicalRole };

/**
 * Where a metric's value comes from — the one place a *source* is named, so a
 * non-register source has somewhere to put its addressing instead of borrowing
 * Modbus fields. A tagged union rather than optional fields: the runtime
 * implements a closed set of arms, and an arm it does not implement is rejected
 * when the profile is parsed, never discovered at read time.
 *
 * - `modbus`  holding register(s), decimal addresses. Length matches `type`:
 *             1 for `U_WORD`/`S_WORD`, 2 (`[low, high]`) for `U_DWORD`, N for `RAW`.
 * - `http`    a value inside the JSON body of one GET, addressed by RFC 6901
 *             JSON pointer. No width and no encoding: the body already answers
 *             `236.402`, so there is nothing to combine, only somewhere to look.
 * - `compute` derived from other decoded values; never read from the wire.
 * - `control` composite control; writing runs the expression instead of a
 *             register write.
 *
 * `scale`/`offset` deliberately stay on {@link MetricBase} — an API answering
 * deciwatts needs them exactly as much as a register does.
 */
export type Binding =
  | { via: "modbus"; addr: number[]; type: RegisterType }
  | { via: "http"; pointer: string }
  | { via: "compute"; expr: ComputeExpr }
  | { via: "control"; expr: ControlExpr };

/** Expected value bounds for gauge-style widgets. */
export interface MetricRange {
  min: number;
  max: number;
}

/** Human labels for a signed metric's direction (e.g. battery charge/discharge). */
export interface MetricFlow {
  /** Meaning when value > 0. */
  positive: string;
  /** Meaning when value < 0. */
  negative: string;
}

/**
 * Everything the runtime {@link MetricDef} and its serializable mirror
 * (`MetricDataDef` in `./profile-data`) agree on: identity, wire encoding, the
 * composite-control expression, and the render metadata the UI contracts on.
 *
 * The two shapes differ *only* in how a derived value is carried — a compiled
 * closure (`compute`) vs. a declarative expression (`computeExpr`) — so they
 * share this base rather than restating twenty fields twice.
 */
export interface MetricBase {
  /** Canonical key, dotted form of the MQTT topic, e.g. `dc.pv1.power`. */
  key: string;
  /** MQTT topic suffix from the vendor docs, e.g. `dc/pv1/power`. */
  topic: string;
  /** Human label. */
  label: string;
  /** Physical unit, or `null` for status/enum values. */
  unit: string | null;
  /** Logical grouping (inverter, battery, generator, settings, ...). */
  group: string;
  /** Where the value comes from, and how to address it. */
  binding: Binding;
  /**
   * @deprecated Legacy Modbus mirror of {@link binding}, kept while the read
   * planner and simulator still read it directly. New code reads the binding;
   * the mirror disappears once those move behind the transport interface.
   */
  type: RegisterType;
  /**
   * @deprecated Legacy Modbus mirror of {@link binding} — `addr` for a `modbus`
   * binding, empty for every other arm. See {@link type}.
   */
  addresses: number[];
  /** Multiply the raw integer by this to get engineering units. */
  scale: number;
  /**
   * Minimum change worth persisting, **in this metric's own unit**. A change
   * smaller than this is not stored; the comparison is against the last value
   * that *was* stored, carried forward, so the stored series is never wrong by
   * more than this threshold. Absent ⇒ every change is stored.
   *
   * There is no zero. "No threshold" is absence, never `0` — a counter or an
   * enum has no threshold at all, and spelling that `0` makes "not applicable"
   * indistinguishable from a real threshold of zero, the same sentinel trap
   * `decode()` avoids one layer down.
   *
   * Floor is {@link scale}: a change below the register's quantisation step is
   * unrepresentable, so a smaller `deadband` is an authoring error, not a no-op.
   * Only meaningful where {@link storage} resolves to `series`.
   */
  deadband?: number;
  /**
   * Added after scaling: engineering value = `raw * scale + offset`. For the
   * vendor "+1000" temperature encoding (register = °C×10 + 1000) pair
   * `scale: 0.1` with `offset: -100`. Absent ⇒ treated as 0.
   */
  offset?: number;
  access: MetricAccess;
  /**
   * Composite control — writing to this metric runs the declarative
   * {@link ControlExpr} instead of a raw register write. Addressless (no wire
   * read/write of its own); the runtime interprets it and dispatches to the
   * referenced target metric(s).
   */
  controlExpr?: ControlExpr;

  // --- Semantic / render metadata (the UI contract) ---
  /** Canonical concept, if this metric maps to one. */
  role?: CanonicalRole;
  /** Position for indexed roles (PV string, grid/load phase). 1-based. */
  index?: number;
  /** Overrides the kind inferred from `access`/`unit`. */
  kind?: MetricKind;
  /** Overrides the storage class derived from the resolved kind. */
  storage?: MetricStorage;
  /** Expected bounds for gauges. */
  range?: MetricRange;
  /** Enum → label map for `status` metrics. */
  enumLabels?: Record<number, string>;
  /** Direction labels for signed measurements. */
  flow?: MetricFlow;
}

/** Runtime metric: {@link MetricBase} with the compiled derived value. */
export interface MetricDef extends MetricBase {
  /**
   * Derived metric — computed from other decoded values instead of read from
   * Modbus. Applied both on real reads and in simulation.
   */
  compute?: (values: MetricValues) => number;
  /**
   * Metric keys `compute` reads, derived from the declarative expression at
   * parse time (never serialized). Lets the read planner resolve a computed
   * metric's raw registers and sample them in one atomic Modbus transaction.
   */
  computeInputs?: string[];
}

/** Persistent, profile-owned simulation state (SoC, energy counters, ...). */
export type SimState = Record<string, number>;

export interface SimContext {
  /** Wall-clock time of this sample. */
  now: Date;
  /** Seconds elapsed since the previous sample (0 on the first sample). */
  dtSec: number;
  /** Mutable state the profile may read and update across samples. */
  state: SimState;
}

/**
 * Profile-specific coherent simulation. Returns partial `MetricValues`; any
 * metric it omits is filled by the generic fallback. Computed metrics run
 * afterwards regardless.
 */
export type SimulateFn = (ctx: SimContext) => MetricValues;

export interface InverterProfile {
  /** Stable slug used to select the profile at runtime, e.g. `deye-sg05lp3`. */
  id: string;
  name: string;
  manufacturer: string;
  metrics: MetricDef[];
  /** Optional coherent simulator; falls back to generic synthesis if absent. */
  simulate?: SimulateFn;
}

/** Which optional subsystems a specific inverter exposes. */
export type InverterFeature = "solar_sell" | "time_of_use" | "grid_charge";

/**
 * What the inverter can do — derived from the roles/groups present in its
 * profile (plus explicit declarations). The UI switches whole sections on/off
 * from this instead of probing individual metric keys.
 */
export interface InverterCapabilities {
  battery: boolean;
  /** Number of PV (MPPT) strings, from distinct `pv.string.*` indices. */
  pvStrings: number;
  /** 1 or 3, from distinct `grid.phase.voltage` indices. */
  phases: number;
  grid: boolean;
  generator: boolean;
  /** Backup / UPS load output present. */
  backupLoad: boolean;
  features: InverterFeature[];
  /** Keys of writable metrics the UI may expose as controls. */
  controls: string[];
}

/** Serialized, render-ready view of a metric (no functions, no addresses). */
export interface ManifestMetric {
  key: string;
  /** MQTT topic suffix (`/`-separated) — the transport mapping for this entity. */
  topic: string;
  label: string;
  unit: string | null;
  group: string;
  kind: MetricKind;
  /**
   * Resolved storage class — the UI uses it to stop offering a custom chart over
   * a metric that has no history to chart.
   */
  storage: MetricStorage;
  writable: boolean;
  role?: CanonicalRole;
  index?: number;
  range?: MetricRange;
  enumLabels?: Record<number, string>;
  flow?: MetricFlow;
}

/**
 * The full contract sent to clients: identity + capabilities + render-ready
 * metric catalog. A UI can build itself entirely from this.
 */
export interface InverterManifest {
  id: string;
  name: string;
  manufacturer: string;
  capabilities: InverterCapabilities;
  metrics: ManifestMetric[];
}

/**
 * Modbus framing over a TCP socket:
 * - `tcp`          standard Modbus TCP (MBAP header, no CRC).
 * - `rtu-over-tcp` RTU frames (with CRC) tunneled over TCP — what many
 *                  RS485→Ethernet gateways (USR, Waveshare, PUSR) and some
 *                  inverter loggers actually speak.
 */
export type InverterTransport = "tcp" | "rtu-over-tcp";

export interface InverterConnection {
  host: string;
  port: number;
  unitId: number;
  /** Per-request Modbus timeout, ms. */
  timeoutMs?: number;
  /** Framing over the socket; defaults to `tcp`. */
  transport?: InverterTransport;
}

/**
 * Where an HTTP-polled device answers, and how long to wait.
 *
 * Deliberately not a widening of {@link InverterConnection}: that type is Modbus
 * vocabulary — a host, a port, a unit id, a framing — and an HTTP source shares
 * none of it. {@link DeviceTransport} never mentions a connection, so two
 * transports needing two connection shapes costs the seam nothing.
 */
export interface HttpConnection {
  /** Absolute URL of the one GET that answers the whole device. */
  url: string;
  /** Deadline for that request, ms. Defaults to 5000. */
  timeoutMs?: number;
  /** Extra request headers, e.g. an API token. */
  headers?: Record<string, string>;
}

/**
 * One timestamped reading of every numeric metric in a profile.
 *
 * `time` is when the sample was assembled, and for a single atomic read that is
 * also when every value was true. The two optional fields exist for when it is
 * not: {@link degraded} says the values in this sample were not all sampled
 * together, and {@link readAt} says exactly when each one was, for the
 * transports that know. Both are absent on a healthy Modbus poll, so nothing
 * downstream has to learn a field to keep working.
 */
export interface InverterSample {
  time: string;
  inverterId: string;
  metrics: MetricValues;
  /**
   * These values did not all come from one device-side snapshot — set when the
   * transport is reading in a degraded mode, such as Modbus after a rejected
   * atomic group is split into separate transactions. Derived values over them
   * can show transient skew on fast power swings, so a consumer may want to mark
   * them rather than present them as coherent.
   */
  degraded?: boolean;
  /**
   * Per-metric read times (epoch ms) for the transports that know them — a push
   * source stamps each key as it arrives. Absent, or missing a key, means the
   * only time available is the sample's own; it never means "never read".
   */
  readAt?: Record<string, number>;
}

/**
 * How a device is actually talked to — the one seam every source-specific
 * concern hides behind.
 *
 * The Modbus implementation owns contiguous-block coalescing, the per-request
 * register cap, atomic compute groups and the exception-2 split-and-remember
 * fallback. None of that generalises: a single HTTP GET is atomic for free, and
 * a push transport has no read to plan at all. So the interface promises only
 * what every source can honour — a connect, a whole-device read, a keyed write
 * in engineering units, a close — and declares the rest through {@link caps}.
 */
export interface DeviceTransport {
  /** Short identifier for logs and diagnostics, e.g. `modbus`. */
  readonly kind: string;
  /** Open the underlying connection. Idempotent; a read may do it lazily. */
  connect(): Promise<void>;
  /**
   * One whole-device read: decoded values keyed by metric key. `readAt` carries
   * per-key read times (epoch ms) when — and only when — the transport knows
   * them: a push source stamps each key as it arrives, while a block-reading
   * poll has one time for a whole span and reports none. `degraded` says these
   * values were not all sampled together; both ride onto the
   * {@link InverterSample} unchanged.
   */
  read(): Promise<{
    values: MetricValues;
    readAt?: Record<string, number>;
    degraded?: boolean;
  }>;
  /** Write a `rw` metric in engineering units. */
  write(key: string, value: number): Promise<void>;
  /**
   * What this transport can do, so callers branch on the capability instead of
   * probing the `kind`. `pushBased` transports deliver values on their own
   * schedule; polling them is a no-op read of the last known state.
   */
  readonly caps: { canWrite: boolean; pushBased: boolean };
  close(): Promise<void>;
}

/** A source (real Modbus or simulator) exposing the same profile-shaped sample. */
export interface InverterSource {
  readonly profile: InverterProfile;
  read(): Promise<InverterSample>;
  /** Write a `rw` metric in engineering units. */
  write(key: string, value: number): Promise<void>;
  close(): Promise<void>;
}
