// Motion values with no CSS token (ADR 21), named here so a screen never holds a literal. Each one
// stops on the still tier where it is used: through `motionMs`, or because the spring or tween
// lands at once there.

/** A figure counting up from zero as it first shows. */
export const COUNT_UP_MS = 900;

/** History's figures and breakdown rows gliding to a new range's values. */
export const FIGURE_GLIDE_MS = 320;

/** `--motion-exit`, for a timer that waits an exit out. */
export const EXIT_MS = 150;

/** The springs that take over from a finger at its release velocity. */
export const SPRINGS = {
  /** A drill-in's back-swipe. */
  drillIn: { stiffness: 300, damping: 32 },
  /** A range card's pane. */
  pager: { stiffness: 320, damping: 36 },
  /** The builder's inspector sheet. */
  inspector: { stiffness: 380, damping: 36 },
  /** The value editor's wheel. */
  wheel: { stiffness: 320, damping: 30 },
} as const;
