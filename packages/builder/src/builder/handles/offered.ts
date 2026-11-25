// Which of the picked object's handles are offered (ADR 20, mistaken drags): the ring in the turn
// mode and nothing else; out of it everything but the ring, and for a block the knob that carries
// it, since its own surface orbits. Pure.
import type { Scene } from "../pv.ts";
import { bodyOf, onWorld } from "./body.ts";
import { handles, type Handle, type Laid, type Target } from "./grips.ts";

/** Metres a block's knob stands before its front wall and above the ground, and left of the
 * wall's middle, where the depth arrow is: clear of the wall's face, and in sight on a phone. */
const BEFORE = 0.8;
const LOW = 0.3;
const ASIDE = 1.6;

/** The knob before block `target`'s front wall; none for anything else. */
function knob(scene: Scene, target: Target): Handle[] {
  const body = target.kind === "block" ? bodyOf(scene, target) : undefined;

  if (body === undefined || body.kind === "round") return [];

  const across = Math.max(body.width / 2 - ASIDE, 0);

  return [{ grip: "carry", at: onWorld(scene.north, body, across, LOW, body.depth + BEFORE) }];
}

/** The handles to show and to grab for `target`, in the turn mode or out of it; an editor's
 * `ring` shows beside the others. */
export function offered(
  scene: Scene,
  target: Target,
  laid: Laid,
  turning: boolean,
  ring = false,
): Handle[] {
  const found = handles(scene, target, laid);

  if (turning) return found.filter(({ grip }) => grip === "turn");

  return [...found.filter(({ grip }) => ring || grip !== "turn"), ...knob(scene, target)];
}

/** Whether `target` has a ring to turn it by. */
export function turnable(scene: Scene, target: Target, laid: Laid): boolean {
  return handles(scene, target, laid).some(({ grip }) => grip === "turn");
}
