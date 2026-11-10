// Generated from crates/profile by `bun run --cwd packages/sdk types`. Do not edit.

export type Capability = "modbus" | "mqtt" | "http" | "sunspec" | "u16" | "i16" | "u32" | "acc32" | "scale-factor" | "compute" | "deadband" | "write" | "write-block" | "rmw" | "activate" | "precondition" | "unlock" | "delay" | "snapshot-toggle" | "publish" | "identify" | "ac-rating" | "resolution" | "text-enum" | "setting-text" | "verified" | "poll-group";

export type Profile = { schema: 1, id: string, name: string, manufacturer: string, version: string, requires: Array<Capability>, quantities: Array<Quantity>, inverter?: Inverter, 
/**
 * Fields that tell the device from any other on the bus; the setup scan proposes the profile
 * only when each holds one of its values.
 */
identify?: Array<Identify>, settings?: Array<Setting>, 
/**
 * Each poll group's cadence in seconds, by name: a whole number of default cycles.
 */
pollGroups?: Record<string, number>, };

export type Quantity = { key: string, role: string, index?: number, 
/**
 * The SunSpec models it reads, by ID; the first the device's chain holds is read. `register`
 * then counts from the model's ID register, as the SunSpec model definitions lay it out.
 */
model?: Array<number>, register?: number, 
/**
 * An `mqtt` topic under the connection's root; `{address}` stands for the device address.
 */
topic?: string, 
/**
 * An `http` GET of a path on the connection's host, such as `/rpc/EM.GetStatus?id=0`;
 * `{address}` stands for the device address.
 */
get?: string, 
/**
 * A JSON Pointer (RFC 6901) into the answer to `get`, such as `/total_act_power`.
 */
json?: string, type?: Kind, scale?: number, 
/**
 * The register holding the power of ten the value is scaled by, read with it (SunSpec's
 * `sunssf`).
 */
scaleFactor?: number, 
/**
 * The step a value scaled by a register is stored in, as no scale fixes it (ADR 3).
 */
resolution?: number, offset?: number, compute?: Expr, range?: Range, 
/**
 * A topic's text payloads and the values they read as, such as EVCC's loadpoint mode.
 */
enum?: Record<string, number>, 
/**
 * The smallest change stored, in the role's unit, for this hardware (ADR 4); never below
 * the quantisation step, and none for a counter or enum.
 */
deadband?: number, 
/**
 * The poll group it is read in; the default cadence when left out.
 */
pollGroup?: string, };

export type Kind = "u16" | "i16" | "u32" | "acc32";

export type Range = { min: number, max: number, };

export type Expr = { "sum": Array<string> } | { "diff": [string, string] } | { "combine": { add: Array<string>, sub?: Array<string>, } } | { "ratio": { num: Array<string>, den: Array<string>, scale?: number, } } | { "clamp": { key: string, min?: number, max?: number, } };

export type Identify = { register: number, 
/**
 * `u16` when left out.
 */
type?: Kind, values: Array<number>, };

export type Inverter = { 
/**
 * Volts.
 */
maxInputVoltage: number, 
/**
 * Watts of AC output at its rating: the forecast caps the inverter there.
 */
acRating: number | null, 
/**
 * The MPPT inputs, numbered from 1 in order, as `pv.mppt.*` indices.
 */
mppt: Array<Mppt>, };

export type Mppt = { 
/**
 * Amperes.
 */
maxCurrent: number, 
/**
 * The voltage window, in volts.
 */
minVoltage: number, maxVoltage: number, 
/**
 * Volts.
 */
startVoltage: number, };

export type Setting = { key: string, 
/**
 * What the settings screen calls it; the key when left out.
 */
name?: string, type: Kind, 
/**
 * The unit of its value after scaling.
 */
unit?: Unit, scale?: number, range?: Range, values?: Array<number>, 
/**
 * The text the settings screen shows for each of `values`, keyed by the value.
 */
labels?: Record<string, string>, 
/**
 * Seconds.
 */
minInterval: number, recipe: Array<Step>, readBack?: ReadBack, writeOnly?: boolean, 
/**
 * Its write was checked on real hardware (ADR 5); an unverified setting needs the admin's
 * enable (ADR 8).
 */
verified?: boolean, };

export type Unit = "W" | "kWh" | "V" | "A" | "Hz" | "%" | "°C";

export type Step = { "write": Register } | { "writeBlock": WriteBlock } | { "rmw": Masked } | { "activate": Activate } | { "precondition": Precondition } | { "unlock": Unlock } | { "delay": Delay } | { "snapshotToggle": SnapshotToggle } | { "publish": Publish };

export type Register = { register: number, };

export type WriteBlock = { register: number, words: Array<number | "value">, };

export type Delay = { ms: number, };

export type Activate = { register: number, value: number, };

export type Precondition = { register?: number, mask?: number, 
/**
 * The key of a quantity read from a topic, in place of a register.
 */
quantity?: string, values: Array<number>, };

export type Publish = { topic: string, };

export type Unlock = { register: number, type: Kind, 
/**
 * The secret's name on the connection; its value never appears in a profile.
 */
secret: string, 
/**
 * Fixed writes that relock, run even after a failure.
 */
finally: Array<Relock>, };

export type Relock = { register: number, words: Array<number>, };

export type SnapshotToggle = { 
/**
 * The key of the setting it locks.
 */
target: string, locked: number, };

export type Masked = { register: number, mask: number, };

export type ReadBack = { register?: number, mask?: number, 
/**
 * The key of a quantity read from a topic, in place of a register.
 */
quantity?: string, };

export type Block = { start: number, count: number, 
/**
 * Holds every input of a computed quantity, so they share one device snapshot.
 */
grouped?: boolean, 
/**
 * Folded across unmapped registers: the only plain block a device may refuse with exception 2.
 */
merged?: boolean, };

export type Support = { schema: Schemas, capabilities: Array<Capability>, };

export type Schemas = { min: number, max: number, };
