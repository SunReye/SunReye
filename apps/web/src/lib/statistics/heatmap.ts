// Colour ramp for the hour×weekday energy heatmap. Pure so the stops and the
// interpolation are unit-testable without mounting a canvas chart.
//
// The ramp is deliberately MULTI-HUE (pale amber → amber → orange → deep red):
// a single-hue ramp reads as a wash of one colour across 168 small cells, and
// the household asked for a heat map that actually looks like heat. The stops
// are lightness-ordered, so it still reads as a sequential ramp rather than a
// rainbow — a reader sorting cells by colour sorts them by value.
//
// Stops validated with the dataviz skill's palette validator in `--ordinal`
// mode against both surfaces (#ffffff light, #0a0a0a dark): monotone lightness,
// adjacent ΔL ≥ 0.06, and the lightest step clearing 2:1 against white all
// pass. The validator's "single hue" check fails by construction — that is the
// multi-hue requirement above, not a defect — and is the one deviation.

/** Ramp stops, low value → high value. Not exported: {@link heatColor} and
 *  {@link heatGradient} are the whole public surface, so the stops can be
 *  re-tuned without touching a caller. */
const HEAT_STOPS = ["#e2ab48", "#d88a12", "#c4450b", "#8a1f36"] as const;

/** Below this share of the maximum a cell is a quiet hour, and fades toward the
 *  chart surface instead of shouting a colour: 168 cells at full opacity have
 *  no visual hierarchy. */
const FADE_UNTIL = 0.25;

/** The floor of that fade — enough to see the cell exists at all. */
const MIN_OPACITY = 0.12;

const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : Number.isNaN(t) ? 0 : t);

/** Parse `#rrggbb` into its three 0–255 channels. */
const channels = (hex: string): [number, number, number] => [
  Number.parseInt(hex.slice(1, 3), 16),
  Number.parseInt(hex.slice(3, 5), 16),
  Number.parseInt(hex.slice(5, 7), 16),
];

const hex2 = (v: number): string => Math.round(v).toString(16).padStart(2, "0");

/**
 * The ramp colour at `t` (0 = lowest cell, 1 = the window's maximum), as
 * `#rrggbb`. `t` outside [0, 1] — and NaN, which an all-zero window produces —
 * clamps to the ends rather than throwing.
 */
export function heatColor(t: number): string {
  const pos = clamp01(t) * (HEAT_STOPS.length - 1);
  const lower = Math.min(Math.floor(pos), HEAT_STOPS.length - 2);
  const frac = pos - lower;
  const from = channels(HEAT_STOPS[lower]);
  const to = channels(HEAT_STOPS[lower + 1]);
  return `#${from.map((c, i) => hex2(c + (to[i] - c) * frac)).join("")}`;
}

/**
 * Cell opacity at `t`: a linear fade from {@link MIN_OPACITY} up to fully
 * opaque at {@link FADE_UNTIL} of the maximum, flat above it. Fading toward the
 * surface (rather than toward white) is what makes the ramp work unchanged on
 * both the light and the dark theme.
 */
export function heatOpacity(t: number): number {
  const ramp = clamp01(t) / FADE_UNTIL;
  return MIN_OPACITY + (1 - MIN_OPACITY) * clamp01(ramp);
}

/** CSS gradient for the legend bar, left (lowest) to right (highest). */
export const heatGradient = (): string =>
  `linear-gradient(to right, ${HEAT_STOPS.join(", ")})`;
