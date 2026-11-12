// PROTOTYPE: rAF-driven springs and tweens that start from the current value and velocity,
// so every motion is interruptible and renders only while it runs.

export const easeInOut = (t: number): number => {
  // cubic-bezier(0.65, 0, 0.35, 1), solved by bisection.
  const x1 = 0.65, y1 = 0, x2 = 0.35, y2 = 1;
  const b = (a: number, c: number, s: number) => 3 * a * (1 - s) ** 2 * s + 3 * c * (1 - s) * s ** 2 + s ** 3;
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  let lo = 0, hi = 1;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    if (b(x1, x2, mid) < t) lo = mid;
    else hi = mid;
  }
  return b(y1, y2, (lo + hi) / 2);
};

export function reducedMotion(): boolean {
  return typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export interface SpringOptions {
  stiffness?: number;
  damping?: number;
  mass?: number;
  /** Initial velocity, units per second. */
  velocity?: number;
  precision?: number;
}

/** Animates `from` → `to` on a damped spring. Returns a cancel function. */
export function spring(
  from: number,
  to: number,
  onUpdate: (value: number, velocity: number) => void,
  opts: SpringOptions = {},
  onDone?: () => void,
): () => void {
  const { stiffness = 260, damping = 28, mass = 1, precision = 0.001 } = opts;
  let x = from;
  let v = opts.velocity ?? 0;
  if (reducedMotion()) {
    onUpdate(to, 0);
    onDone?.();
    return () => {};
  }
  let last = performance.now();
  let raf = requestAnimationFrame(function frame(now) {
    let dt = Math.min(0.064, (now - last) / 1000);
    last = now;
    // Substeps keep a stiff spring stable.
    while (dt > 0) {
      const h = Math.min(dt, 1 / 240);
      const a = (-stiffness * (x - to) - damping * v) / mass;
      v += a * h;
      x += v * h;
      dt -= h;
    }
    if (Math.abs(v) < precision * 10 && Math.abs(x - to) < precision) {
      onUpdate(to, 0);
      onDone?.();
      return;
    }
    onUpdate(x, v);
    raf = requestAnimationFrame(frame);
  });
  return () => cancelAnimationFrame(raf);
}

/** Tweens `from` → `to` over `ms` with ADR 21's ease-in-out. Returns a cancel function. */
export function tween(
  from: number,
  to: number,
  ms: number,
  onUpdate: (value: number) => void,
  onDone?: () => void,
  ease: (t: number) => number = easeInOut,
): () => void {
  if (reducedMotion() || ms <= 0) {
    onUpdate(to);
    onDone?.();
    return () => {};
  }
  const t0 = performance.now();
  let raf = requestAnimationFrame(function frame(now) {
    const t = Math.min(1, (now - t0) / ms);
    onUpdate(from + (to - from) * ease(t));
    if (t < 1) raf = requestAnimationFrame(frame);
    else onDone?.();
  });
  return () => cancelAnimationFrame(raf);
}

/** Tracks pointer velocity over the last ~80 ms, in units per second. */
export class VelocityTracker {
  #samples: { t: number; v: number }[] = [];
  push(value: number, t = performance.now()): void {
    this.#samples.push({ t, v: value });
    while (this.#samples.length > 2 && t - this.#samples[0]!.t > 80) this.#samples.shift();
  }
  velocity(): number {
    const s = this.#samples;
    if (s.length < 2) return 0;
    const a = s[0]!, b = s[s.length - 1]!;
    const dt = (b.t - a.t) / 1000;
    if (performance.now() - b.t > 60) return 0;
    return dt > 0 ? (b.v - a.v) / dt : 0;
  }
  reset(): void {
    this.#samples = [];
  }
}
