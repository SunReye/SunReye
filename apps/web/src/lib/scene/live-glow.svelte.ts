// Eases the drawn modules' glow to each live tick, then stops drawing (ADR 20 Motion). A tick
// that moves no glow visibly steps, and one that moves none draws nothing; the still tier and a
// halted stream step (ADR 21).
import type { Group } from "three";
import { glowShift, tint, type Glow } from "../builder/scene.ts";
import { stream } from "../live/stream.svelte.ts";
import { motion } from "../motion/tier.svelte.ts";
import { GlowGlide } from "./glow-glide.ts";

/** ADR 20: tints ease to each tick in about 400 ms. */
const TINT_MS = 400;

/** A glow that moves less than this of its range shows no different: it steps, in one frame. */
const VISIBLE = 0.01;

/** What draws the glide's frames: a studio's opening. */
interface Frames {
  /** Steps `step` in each frame drawn until it returns false; the release ends it early. */
  readonly animate: (step: (now: number) => boolean) => () => void;
  /** Draws in the next frame. */
  readonly render: () => void;
}

/** What lights a group toward a tick's shares: the release it returns ends a glide that still
 * runs, if one began. */
function relighter(glow: () => Glow, frames: Frames) {
  const glide = new GlowGlide();

  /** What was last lit, and how: a tick that changes neither moves nothing. */
  let shown: { readonly group: Group; readonly colour: number; readonly daylight: number } | null =
    null;

  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js recolours it.
  return (group: Group, next: readonly (number | null)[]): (() => void) | null => {
    const light = glow();
    const now = performance.now();
    const moved = glowShift(glide.at(now), next);

    const relit =
      shown?.group !== group || shown.colour !== light.colour || shown.daylight !== light.daylight;

    shown = { group, ...light };
    glide.to(next, now, motion.still || stream.halted || moved < VISIBLE ? 0 : TINT_MS);

    // Nothing moved and nothing is lit anew: no frame is owed.
    if (moved === 0 && !relit && glide.done(now)) return null;

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
  frames: Frames,
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
