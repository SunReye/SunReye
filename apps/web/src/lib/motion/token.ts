// A motion token as a script reads it (ADR 21): 0 on the still tier and under reduced motion.

export type MotionToken = "--motion-move" | "--motion-exit";

/** `token` on `el`, in ms; 0 where it is unset. */
export function tokenMs(el: Element, token: MotionToken): number {
  return Number(getComputedStyle(el).getPropertyValue(token).trim().replace(/ms$/u, "")) || 0;
}
