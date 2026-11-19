// What moves with the weather in a studio (ADR 23 "Motion"): what falls, and the lens glass as
// it fades in and out. Each keeps the studio's loop while it moves, and lets it go when it rests.
/* oxlint-disable typescript/prefer-readonly-parameter-types -- three.js draws with them. */
import { motion } from "../motion/tier.svelte.ts";
import { Fade } from "./lens.ts";
import type { Loop } from "./loop.ts";
import type { Studio } from "./studio.ts";
import type { Falling, Glass } from "./weather.ts";

/** The weather's moving parts, read as they change. */
export interface Moving {
  readonly falling: Falling | null;
  readonly glass: Glass | null;
}

/**
 * Puts the glass on the lens: it fades in and out in the loop, which it keeps until the lens is
 * clear again or frost alone stands on it; off the full tier, where nothing loops, the lens is
 * cleared at once. The release returned lets the loop go for good.
 */
function glazed(
  studio: Studio,
  loop: Loop,
  render: () => void,
  glass: () => Glass | null,
): () => void {
  /** The lens glass as it fades, and its hold on the loop while anything on it moves or fades. */
  const lens = new Fade();
  let glazing: (() => void) | undefined;

  /** Whether the lens owes no frame: it is clear, or frost alone has faded in and stands drawn
   * (ADR 23 "Motion": the loop stops when the weather turns dry). */
  const resting = (): boolean => lens.clear || lens.still;

  const unglaze = (): void => {
    glazing?.();
    glazing = undefined;
  };

  const glaze = (target: Glass | null): void => {
    lens.aim(target);

    if (resting()) return;

    glazing ??= loop.keep((seconds) => {
      studio.lens(lens.at(seconds), seconds);

      // The loop's last frame is drawn through the lens as it stands.
      if (resting()) unglaze();
    });
  };

  $effect(() => {
    const target = glass();

    if (motion.tier === "full") {
      glaze(target);

      return;
    }

    lens.cut();
    studio.lens(null, 0);
    unglaze();
    render();
  });

  return unglaze;
}

/**
 * Shows what moves with the `weather`, read as it changes (ADR 23). What falls is shown as the
 * motion tier does: it moves in the loop on full, lite draws a sparse still field, still draws
 * none. The glass is put on the lens. Call during a component's set-up; the release returned
 * lets the loop go for good.
 */
export function weatherMoves(
  studio: Studio,
  loop: Loop,
  render: () => void,
  weather: Moving,
): () => void {
  const unglaze = glazed(studio, loop, render, () => weather.glass);

  $effect(() => {
    const fell = weather.falling;
    const { tier } = motion;

    studio.fall(tier === "still" ? null : fell, tier === "lite");
    render();

    return fell !== null && tier === "full"
      ? loop.keep((seconds) => {
          studio.drift(seconds);
        })
      : undefined;
  });

  // The loop is the full tier's, whoever keeps it.
  $effect(() => {
    loop.pause("tier", motion.tier !== "full");
  });

  return unglaze;
}
