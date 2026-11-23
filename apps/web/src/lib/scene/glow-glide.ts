// The modules' live glow eases to each tick (ADR 20).
import { easeInOut } from "@sunreye/ui/motion/ease";

export type Shares = readonly (number | null)[];

/** Each module's string share of peak, eased from what is shown to each tick's. */
export class GlowGlide {
  #from: Shares = [];
  #to: Shares = [];
  #start = 0;
  #duration = 0;

  /** Eases to `shares` from `now`, both in milliseconds; 0 steps there. */
  to(shares: Shares, now: number, duration: number): void {
    const first = this.#to.length === 0;

    this.#from = first ? shares : this.at(now);
    this.#to = shares;
    this.#start = now;
    this.#duration = first ? 0 : duration;
  }

  at(now: number): Shares {
    if (this.done(now)) return this.#to;

    const t = easeInOut((now - this.#start) / this.#duration);

    return this.#to.map((to, i) => {
      const from = this.#from[i] ?? 0;

      return from + ((to ?? 0) - from) * t;
    });
  }

  done(now: number): boolean {
    return now - this.#start >= this.#duration;
  }
}
