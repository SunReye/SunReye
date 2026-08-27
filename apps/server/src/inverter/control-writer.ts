/**
 * The register-write funnel, peeled out of the runtime so it owns the single
 * path every inbound command travels — the web command endpoint, the MQTT
 * bridge, and the automation loop all write through this one function — and can
 * be tested without a runtime, a poll loop or a transport around it.
 *
 * Because it is the one path, it is also the one validation point: the key and
 * value are checked against the profile's metadata here, so no entry point
 * carries its own copy of the rule and a new one cannot forget it.
 *
 * A plain register write hands straight to the live source; a composite control
 * (`controlExpr`) instead runs its declarative action through the interpreter
 * (control-expr.ts), which dispatches to the real target register(s). Either
 * way the funnel stays a single *awaited* path — no register write is ever
 * fire-and-forget — and the not-started guard runs before the context is
 * consulted, so a command into a runtime that never booted is refused cleanly.
 *
 * The live source is read through an accessor on every call, never captured:
 * the runtime swaps the source (and closes the old one) when connection
 * settings change, so the funnel must always resolve the *current* one. Every
 * other collaborator (the context, the control-state store, the live-value
 * reader) is injected too, so this module pulls in no db/env dependency and a
 * second instance shares nothing.
 */

import type { InverterSample, InverterSource } from "@SunReye/inverter-core";

import { type ControlStore, executeControl, injectControlValues } from "./control-expr";
import type { ProfileContext } from "./inverter";
import { WriteRejectedError } from "./write-rejected";

/**
 * A command the profile's own metadata refuses: an unknown key, a register that
 * is not writable, a value outside its range or off its enum. Distinct from a
 * transport failure so an entry point can answer "your value is wrong" (a 400, a
 * warn-and-skip) rather than "the inverter failed" (a 502, an error log) without
 * re-deriving the rule it just got a verdict on.
 *
 * Defined in `./write-rejected` so the interpreter can throw it too without an
 * import cycle, and re-exported here because this funnel is where callers expect
 * to find it.
 */
export { WriteRejectedError };

export interface ControlWriterDeps {
  /**
   * The live source, resolved on every call so a source swap is transparent —
   * `null` before the runtime has built one, which the funnel refuses on.
   */
  getSource(): InverterSource | null;
  /** The active profile context, resolved on every call. */
  getContext(): ProfileContext;
  /** Persistent state for composite (snapshotToggle) controls. */
  store: ControlStore;
  /** Current live value of a target register, or `undefined` if unknown. */
  readLive(target: string): number | undefined;
}

export interface ControlWriter {
  /**
   * Apply an inbound command to the live source. A plain register write hands
   * straight through; a composite control runs its `controlExpr` action via the
   * interpreter. A single awaited path — never fire-and-forget. Throws
   * "inverter not started" if no source is built yet (checked before the
   * context is read), and a {@link WriteRejectedError} when the profile's
   * metadata refuses the key or the value.
   */
  write(key: string, value: number): Promise<void>;
  /**
   * Fold each composite control's current value into a freshly-read sample, so
   * every downstream surface sees lock state even though the control owns no
   * register. Reads cached state — no per-poll db hit.
   */
  injectState(sample: InverterSample): Promise<void>;
}

/**
 * Build a register-write funnel. Every collaborator is injected and the source
 * is read lazily, so a second instance shares nothing and a test drives it
 * against in-memory doubles.
 */
export function createControlWriter(deps: ControlWriterDeps): ControlWriter {
  const { getSource, getContext, store, readLive } = deps;

  async function write(key: string, value: number): Promise<void> {
    // The null-source guard runs before the context is consulted, so a command
    // into a not-yet-started runtime is refused rather than tripping over an
    // unbuilt context.
    const source = getSource();
    if (!source) throw new Error("inverter not started");
    const ctx = getContext();
    // Validation lives here, ahead of the controlExpr branch, so every entry
    // point (web command, MQTT bridge, automation loop, the next one nobody has
    // written yet) is covered by the profile's own bounds/enum without a copy of
    // the rule at each call site — and a composite write is checked too.
    const invalid = ctx.validateWrite(key, value);
    if (invalid) throw new WriteRejectedError(invalid);
    // A composite control (controlExpr) runs its declarative action instead of a
    // raw register write; the interpreter dispatches to the real target(s).
    const def = ctx.defByKey.get(key);
    if (def?.controlExpr) {
      return executeControl(def, value, {
        ctx,
        store,
        write: (target, v) => source.write(target, v),
        readLive,
      });
    }
    await source.write(key, value);
  }

  async function injectState(sample: InverterSample): Promise<void> {
    await injectControlValues(sample, getContext(), store);
  }

  return { write, injectState };
}
