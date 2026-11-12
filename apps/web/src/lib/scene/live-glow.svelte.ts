// Eases the drawn modules' glow to each live tick, then stops drawing (ADR 20). The still tier and a
// halted stream step (ADR 21).
import type { Group } from "three";
import type { Glow } from "../builder/scene.ts";
import { tint } from "../builder/scene.ts";
import { stream } from "../live/stream.svelte.ts";
import { motion } from "../motion/tier.svelte.ts";
import { GlowGlide } from "./glow-glide.ts";

/** ADR 20: tints ease to each tick in about 400 ms. */
const TINT_MS = 400;

/** Runs inside an effect root; `render` draws in the next frame. */
export function easeGlow(
  drawn: () => Group | undefined,
  shares: () => readonly (number | null)[] | undefined,
  glow: () => Glow,
  render: () => void,
): void {
  const glide = new GlowGlide();

  $effect(() => {
    const next = shares();
    const group = drawn();
    let frame = 0;

    if (next !== undefined && group !== undefined) {
      glide.to(next, performance.now(), motion.still || stream.halted ? 0 : TINT_MS);

      const light = glow();

      const step = (): void => {
        const now = performance.now();

        tint(group, glide.at(now), light);
        render();

        if (!glide.done(now)) frame = requestAnimationFrame(step);
      };

      step();
    }

    return () => {
      cancelAnimationFrame(frame);
    };
  });
}
