// A motion token as a script reads it (ADR 21): 0 on the still tier and under reduced motion.

export type MotionToken = "--motion-move" | "--motion-exit";

/**
 * `token` on `el`, in ms; 0 where it is unset. A custom property reads as written, and the built
 * stylesheet writes `300ms` as `.3s`: both units are read.
 */
export function tokenMs(el: Element, token: MotionToken): number {
  const written = getComputedStyle(el).getPropertyValue(token).trim();
  const time = Number(written.replace(/m?s$/u, "")) || 0;

  return written.endsWith("ms") ? time : time * 1000;
}
