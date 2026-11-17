// A finger on a full screen (ADR 21 "Sheet content"): it reads the band under it at once and
// leads, lifted it leaves that band read, and lifted on the band it went down on it taps.

/** How a finger reads a chart: held first inside a sheet, else at once. */
export type Finger<P> = Readonly<Record<"down" | "move" | "up", (e: P) => void>> & {
  readonly end: () => void;
};

export class AtOnce<P> implements Finger<P> {
  readonly #over: (e: P) => number;
  readonly #write: (at: number | null) => void;
  readonly #tap: (at: number) => void;
  #pressed = false;
  /** The band it went down on, while it stays there. */
  #from: number | null = null;

  /**
   * @param over the band under a pointer event
   * @param write sets the band being read, null with none
   * @param tap a finger lifted on the band it went down on
   */
  constructor(
    over: (e: P) => number,
    write: (at: number | null) => void,
    tap: (at: number) => void,
  ) {
    [this.#over, this.#write, this.#tap] = [over, write, tap];
  }

  down = (e: P): void => {
    this.#pressed = true;
    this.#from = this.#over(e);
    this.#write(this.#from);
  };

  move = (e: P): void => {
    if (!this.#pressed) return;

    const i = this.#over(e);

    if (i !== this.#from) this.#from = null;

    this.#write(i);
  };

  up = (): void => {
    const tapped = this.#from;

    this.#pressed = false;
    this.#from = null;

    if (tapped !== null) this.#tap(tapped);
  };

  /** The browser took the finger, to scroll. */
  end = (): void => {
    this.#pressed = false;
    this.#from = null;
    this.#write(null);
  };
}
