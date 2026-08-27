/**
 * How an instant is snapped to the grain the app's shared "now" advances in. The
 * reactive half is `live-clock.svelte.ts`; this is the part a test can call.
 *
 * The grain is deliberately NOT exported. Its only runtime consumer is the
 * function below, and `live-clock.test.ts` pins it where it can be observed
 * — at real instants: one value across a whole minute, a fresh one at the next,
 * and a civil midnight landing on itself. That says "the grain is a minute,
 * aligned to minutes" without a second copy of the number to keep in step.
 */

/**
 * One minute.
 *
 * The clock is driven by the live feed's own frames (see the rune shell), which
 * land about once a second. Handing that straight on as `now` would invalidate
 * everything derived from it sixty times a minute — the navigator's title, its
 * live pill, the forward arrow's disabled state — on the page whose reactive
 * budget produced the PR #60 outage. A minute is the coarsest grain that still
 * notices a civil midnight promptly, and the only boundary this clock exists to
 * notice is a period boundary.
 */
const CLOCK_GRAIN_MS = 60_000;

/**
 * `ms` snapped DOWN to {@link CLOCK_GRAIN_MS}.
 *
 * Floored, not rounded: a rounded clock reads up to half a grain into the
 * future, and `containsNow` would then call the next day live before it had
 * started. Every civil day boundary is a whole minute in every IANA zone, so
 * flooring lands exactly on midnight rather than a grain short of it.
 */
export function clockTick(ms: number): number {
  return Math.floor(ms / CLOCK_GRAIN_MS) * CLOCK_GRAIN_MS;
}
