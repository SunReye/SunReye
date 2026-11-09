// Generated from crates/profile by `bun run --cwd packages/sdk types`. Do not edit.

export type Capability = "modbus" | "u16" | "i16" | "u32" | "compute" | "write" | "write-block" | "rmw" | "activate" | "precondition" | "unlock" | "delay" | "snapshot-toggle";

export type Profile = { schema: 1, id: string, name: string, manufacturer: string, version: string, requires: Array<Capability>, quantities: Array<Quantity>, inverter?: Inverter, settings?: Array<Setting>, };

export type Quantity = { key: string, role: string, index?: number, register?: number, type?: Kind, scale?: number, offset?: number, compute?: Expr, range?: Range, };

export type Kind = "u16" | "i16" | "u32";

export type Range = { min: number, max: number, };

export type Expr = { "sum": Array<string> } | { "diff": [string, string] } | { "combine": { add: Array<string>, sub?: Array<string>, } } | { "ratio": { num: Array<string>, den: Array<string>, scale?: number, } } | { "clamp": { key: string, min?: number, max?: number, } };

export type Inverter = { 
/**
 * Volts.
 */
maxInputVoltage: number, 
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

export type Setting = { key: string, type: Kind, scale?: number, range?: Range, values?: Array<number>, 
/**
 * Seconds.
 */
minInterval: number, recipe: Array<Step>, readBack?: ReadBack, writeOnly?: boolean, };

export type Step = { "write": Register } | { "writeBlock": WriteBlock } | { "rmw": Masked } | { "activate": Activate } | { "precondition": Precondition } | { "unlock": Unlock } | { "delay": Delay } | { "snapshotToggle": SnapshotToggle };

export type Register = { register: number, };

export type WriteBlock = { register: number, words: Array<number | "value">, };

export type Delay = { ms: number, };

export type Activate = { register: number, value: number, };

export type Precondition = { register: number, mask?: number, values: Array<number>, };

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

export type ReadBack = { register: number, mask?: number, };

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
