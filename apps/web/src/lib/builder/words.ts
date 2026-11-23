// What the scene canvas says, in its consumer's language (ADR 25): it carries no words of its own.

/** The perf readout's names (ADR 21 "Measuring"). */
export interface PerfWords {
  readonly readout: string;
  readonly occlusion: string;
  readonly contact: string;
  readonly ratio: string;
  readonly shadowMap: string;
}

export interface CanvasWords {
  /** The language its numbers are written in, as `Intl` takes it. */
  readonly locale: string;
  /** The canvas's accessible name. */
  readonly scene: string;
  readonly perf: PerfWords;
}
