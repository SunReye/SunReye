// The backdrop's tint follows the sun at the plant (ADR 21): warm at dawn and dusk, clear by day,
// indigo at night. app.css maps each tint to `--spotlight` through `data-tod` on <html>.

export type Tint = "dawn" | "noon" | "dusk" | "night";

/** Civil twilight's edge and its mirror above the horizon bound the warm tints, in degrees. */
const TWILIGHT = 6;

const MINUTE = 60_000;

/** Recomputed this often, and never animated. */
const PERIOD = 15 * MINUTE;

/** The tint for the sun `elevation` degrees above the horizon, climbing or not. */
export function tint(elevation: number, rising: boolean): Tint {
  if (elevation < -TWILIGHT) return "night";

  if (elevation >= TWILIGHT) return "noon";

  return rising ? "dawn" : "dusk";
}

export interface Watch {
  /** The sun's elevation in degrees at `unix` seconds over the plant. */
  elevation: (unix: number) => number;
  set: (tint: Tint) => void;
  now?: () => number;
  /** Runs `fn` every `ms`; returns its stop. */
  every?: (ms: number, fn: () => void) => () => void;
}

function interval(ms: number, fn: () => void): () => void {
  const id = setInterval(fn, ms);

  return () => {
    clearInterval(id);
  };
}

/** Sets the tint now and every 15 minutes; returns the stop. */
export function watchTint({
  elevation,
  set,
  now = Date.now,
  every = interval,
}: Readonly<Watch>): () => void {
  const update = (): void => {
    const unix = Math.floor(now() / 1000);
    const here = elevation(unix);

    set(tint(here, elevation(unix + 60) > here));
  };

  update();

  return every(PERIOD, update);
}
