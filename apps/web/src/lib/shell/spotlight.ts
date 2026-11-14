// The backdrop's tint follows the sun at the plant (ADR 21). The core computes it, so viewers get
// it without the location (ADR 9); app.css maps each tint to `--spotlight` through `data-tod`.
import type { Problem } from "../api/client.ts";
import type { SunTint } from "../api/model.ts";

export type Tint = NonNullable<SunTint["tint"]>;

const MINUTE = 60_000;

/** Reread this often; a new tint is set at once. */
const PERIOD = 15 * MINUTE;

export interface Watch {
  read: () => Promise<SunTint | Problem>;
  /** `undefined` without a location: the backdrop stays indigo. */
  set: (tint: Tint | undefined) => void;
  /** Runs `fn` every `ms`; returns its stop. */
  every?: (ms: number, fn: () => void) => () => void;
}

function interval(ms: number, fn: () => void): () => void {
  const id = setInterval(fn, ms);

  return () => {
    clearInterval(id);
  };
}

/** Sets the core's tint now and every 15 minutes, keeping it through a refused read; returns the stop. */
export function watchTint({ read, set, every = interval }: Readonly<Watch>): () => void {
  let live = true;

  const update = async (): Promise<void> => {
    const told = await read();

    if (live && !("problem" in told)) set(told.tint ?? undefined);
  };

  void update();
  const stop = every(PERIOD, () => void update());

  return () => {
    live = false;
    stop();
  };
}
