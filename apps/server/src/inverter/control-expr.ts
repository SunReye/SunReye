/**
 * Interpreter for composite controls (`controlExpr`). A control metric owns no
 * register; writing to it runs its declarative action here, dispatching to the
 * real target register(s). This is the only place a `controlExpr` executes —
 * inverter-core stays pure data.
 *
 * The interpreter is fully dependency-injected ({@link ControlIO}): it never
 * reaches for the db or the live source directly, so it is unit-testable with
 * in-memory fakes and this module stays free of db/env imports. Production wires
 * it to the `app_settings`-backed `dbControlStore` (see control-store.ts) plus
 * the live source.
 */

import { type ControlLock, type ControlState, controlStateKey } from "@SunReye/db/control-state";
import type { InverterSample, MetricDef } from "@SunReye/inverter-core";
import type { ProfileContext } from "./inverter";

/** Persistent state for stateful controls (snapshotToggle). */
export interface ControlStore {
  get(): Promise<ControlState>;
  set(next: ControlState): Promise<void>;
}

/** Everything the interpreter needs — injected so it stays db/source-agnostic. */
export interface ControlIO {
  ctx: ProfileContext;
  store: ControlStore;
  /** Dispatch a value to a real target register (the live source's write). */
  write(target: string, value: number): Promise<void>;
  /** Current live value of a target register, or `undefined` if unknown. */
  readLive(target: string): number | undefined;
}

/**
 * Run a write against a composite control. `value` is the control's own value
 * (e.g. 1/0 for a snapshotToggle switch). Throws on an invalid value or an
 * unsatisfiable action (e.g. locking with no known live value).
 */
export async function executeControl(def: MetricDef, value: number, io: ControlIO): Promise<void> {
  const expr = def.controlExpr;
  if (!expr) throw new Error(`metric is not a control: ${def.key}`);
  if ("snapshotToggle" in expr) {
    await snapshotToggle(def, expr.snapshotToggle, value, io);
    return;
  }
  if ("preset" in expr) {
    await preset(expr.preset, value, io);
    return;
  }
  const _exhaustive: never = expr;
  throw new Error(`unsupported controlExpr: ${JSON.stringify(_exhaustive)}`);
}

/** The state a single snapshotToggle transition operates on. */
interface ToggleCtx {
  def: MetricDef;
  /** The real register the control locks. */
  target: string;
  /** This control's slot in {@link ControlState}. */
  stateKey: string;
  /** The whole state as read at the start of the transition. */
  state: ControlState;
  io: ControlIO;
}

/**
 * Lock: capture the target's live value, persist it, then write `lockedValue`.
 * Persisting first means the captured value is never lost; a failed device write
 * rolls the snapshot back so the device stays unchanged.
 */
async function engageSnapshot(
  { def, target, stateKey, state, io }: ToggleCtx,
  lockedValue: number,
): Promise<void> {
  const current = io.readLive(target);
  if (current === undefined) {
    throw new Error(
      `cannot lock ${def.key}: current value of "${target}" is unknown (inverter offline?)`,
    );
  }
  await io.store.set({
    ...state,
    [stateKey]: { previousValue: current, lockedAt: new Date().toISOString() },
  });
  try {
    await io.write(target, lockedValue);
  } catch (err) {
    await io.store.set(state);
    throw err;
  }
}

/**
 * Unlock: restore the captured value on the device first and only clear the
 * snapshot once that write lands, so a failed restore stays retryable.
 */
async function releaseSnapshot(
  { def, target, stateKey, state, io }: ToggleCtx,
  engaged: ControlLock,
): Promise<void> {
  const invalid = io.ctx.validateWrite(target, engaged.previousValue);
  if (invalid) throw new Error(`cannot unlock ${def.key}: ${invalid}`);
  await io.write(target, engaged.previousValue);
  const rest = { ...state };
  delete rest[stateKey];
  await io.store.set(rest);
}

async function snapshotToggle(
  def: MetricDef,
  { target, lockedValue }: { target: string; lockedValue: number },
  value: number,
  io: ControlIO,
): Promise<void> {
  const stateKey = controlStateKey(io.ctx.profile.id, def.key);
  const state = await io.store.get();
  const engaged = state[stateKey];
  const ctx: ToggleCtx = { def, target, stateKey, state, io };

  // Both transitions are idempotent: re-locking must never re-snapshot (it would
  // capture the override), and unlocking a released control is a no-op.
  if (value === 1) {
    if (!engaged) await engageSnapshot(ctx, lockedValue);
    return;
  }
  if (value === 0) {
    if (engaged) await releaseSnapshot(ctx, engaged);
    return;
  }

  throw new Error(`snapshotToggle expects 0 or 1, got ${value}`);
}

async function preset(
  { writes }: { writes: { target: string; value: number }[] },
  value: number,
  io: ControlIO,
): Promise<void> {
  if (!value) return; // momentary: only a truthy write applies the preset
  // Not transactional — Modbus has no multi-register atomicity; stop + report on
  // the first failure, leaving earlier writes applied.
  for (const w of writes) {
    const invalid = io.ctx.validateWrite(w.target, w.value);
    if (invalid) throw new Error(`preset target "${w.target}": ${invalid}`);
    await io.write(w.target, w.value);
  }
}

/** The current reported value for a control, from persisted state. */
function controlValueFrom(def: MetricDef, profileId: string, state: ControlState): number {
  const expr = def.controlExpr;
  if (expr && "snapshotToggle" in expr) {
    return state[controlStateKey(profileId, def.key)] ? 1 : 0;
  }
  return 0; // preset (and anything stateless) has no persistent value
}

/**
 * Inject each composite control's current value into a freshly-read sample, so
 * the web/API/MQTT surfaces show lock state (the control owns no register, so it
 * never appears in `source.read()`). Reads cached state — no per-poll db hit.
 */
export async function injectControlValues(
  sample: InverterSample,
  ctx: ProfileContext,
  store: ControlStore,
): Promise<void> {
  const controls = ctx.profile.metrics.filter((m) => m.controlExpr);
  if (controls.length === 0) return;
  const state = await store.get();
  for (const def of controls) {
    sample.metrics[def.key] = controlValueFrom(def, ctx.profile.id, state);
  }
}
