// Eases the drawn modules' glow to each live tick, then stops drawing (ADR 20 Motion). A tick
// that moves no glow visibly steps, and one that moves none draws nothing; the still tier and a
// halted stream step (ADR 21).
import type { Group } from "three";
import { glowShift, tint, type Glow } from "../builder/scene.ts";
import { stream } from "../live/stream.svelte.ts";
import { motion } from "../motion/tier.svelte.ts";
import { GlowGlide } from "./glow-glide.ts";
import type { Opening } from "./opening.svelte.ts";

/** ADR 20: tints ease to each tick in about 400 ms. */
const TINT_MS = 400;

/** A glow that moves less than this of its range shows no different: it steps, in one frame. */
const VISIBLE = 0.01;

/** What was last lit, and how. */
interface Shown extends Glow {
  readonly group: Group;
}

/** Whether `next` lights what `shown` did, the same way: a tick that changes neither moves
 * nothing. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's group, only compared.
const sameLight = (shown: Shown | null, next: Shown): boolean =>
  shown?.group === next.group && shown.colour === next.colour && shown.daylight === next.daylight;

/** How long a glow that moves `moved` of its range glides: a step while still or halted, and
 * where the move would not show. */
const glideMs = (moved: number): number =>
  motion.still || stream.halted || moved < VISIBLE ? 0 : TINT_MS;

/** What lights a group toward a tick's shares, in the frames a studio's opening draws: the
 * release it returns ends a glide that still runs, if one began. */
function relighter(glow: () => Glow, frames: Pick<Opening, "animate" | "render">) {
  const glide = new GlowGlide();
  let shown: Shown | null = null;

  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js recolours it.
  return (group: Group, next: readonly (number | null)[]): (() => void) | null => {
    const light = glow();
    const now = performance.now();
    const moved = glowShift(glide.at(now), next);
    const relit = !sameLight(shown, { group, ...light });

    shown = { group, ...light };
    glide.to(next, now, glideMs(moved));

    // Nothing moved and nothing is lit anew: no frame is owed.
    if (moved === 0 && !relit) return null;

    tint(group, glide.at(now), light);

    if (glide.done(now)) {
      frames.render();

      return null;
    }

    return frames.animate((at) => {
      tint(group, glide.at(at), light);

      return !glide.done(at);
    });
  };
}

/** Runs inside an effect root; the glide's frames are `frames`', held to the frame limit. */
export function easeGlow(
  drawn: () => Group | undefined,
  shares: () => readonly (number | null)[] | undefined,
  glow: () => Glow,
  frames: Pick<Opening, "animate" | "render">,
): void {
  const relight = relighter(glow, frames);

  $effect(() => {
    const next = shares();
    const group = drawn();
    const stop = next === undefined || group === undefined ? null : relight(group, next);

    return () => {
      stop?.();
    };
  });
}
