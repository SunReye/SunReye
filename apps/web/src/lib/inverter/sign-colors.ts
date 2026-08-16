/**
 * The colours that encode a DIRECTION or a JUDGEMENT rather than a quantity:
 * energy arriving or leaving, a grid meter importing or exporting, money earned
 * or spent, a battery healthy or nearly flat.
 *
 * They were Tailwind literals — `text-emerald-500`, `text-red-500`, and three
 * hard-coded `rgb()` stops inside the SOC ramp. That put the most red/green
 * dependent thing in the app outside the theme: a reader who cannot separate
 * red from green could change every other colour and still be told "importing"
 * and "exporting" in two colours they see as one.
 *
 * As tokens they follow the palette. `color-mix()` does the SOC interpolation
 * in CSS instead of arithmetic on baked-in channel values, so the ramp is still
 * a ramp after the tokens change underneath it.
 */

/** Which way energy is moving relative to the inverter. */
export type Flow = "in" | "out" | "idle";

/**
 * Direction of flow on the power-flow diagram. Arriving reads "good", leaving
 * reads "warn" — not because leaving is bad, but because the pair has to be
 * separable and the third state is the static rail.
 */
export function flowClass(flow: Flow): string {
  if (flow === "in") return "text-sign-good";
  if (flow === "out") return "text-sign-warn";
  return "text-border";
}

/**
 * The grid meter speaks cost, not direction: exporting earns, importing costs.
 * The deadband keeps a meter hovering around zero from flickering between two
 * colours — it is ±0.5 W, which is below what any inverter reports honestly.
 */
export function gridClass(watts: number | undefined): string {
  const value = watts ?? 0;
  if (value < -0.5) return "text-sign-good";
  if (value > 0.5) return "text-sign-bad";
  return "text-border";
}

/** Where the SOC ramp changes colour, and which token it changes to. */
interface SocStop {
  at: number;
  token: string;
}

const SOC_STOPS: SocStop[] = [
  { at: 0, token: "--sign-bad" },
  { at: 30, token: "--sign-warn" },
  { at: 60, token: "--sign-good" },
  { at: 100, token: "--sign-good" },
];

/**
 * The battery ring's colour at a given state of charge: flat is bad, healthy is
 * good, with a continuous fade between the stops rather than three bands.
 *
 * Returns a `color-mix()` so the fade happens in CSS against whatever the
 * tokens currently are. Interpolating here — as this did, on `rgb()` triples
 * copied out of Tailwind — bakes the palette into arithmetic and silently
 * ignores any change to it.
 */
export function socColor(soc: number): string {
  const clamped = Math.min(100, Math.max(0, soc));
  let lower = SOC_STOPS[0];
  let upper = SOC_STOPS[SOC_STOPS.length - 1];
  for (let i = 0; i < SOC_STOPS.length - 1; i++) {
    const stop = SOC_STOPS[i]!;
    const next = SOC_STOPS[i + 1]!;
    if (clamped >= stop.at && clamped <= next.at) {
      lower = stop;
      upper = next;
      break;
    }
  }
  if (lower.token === upper.token) return `var(${lower.token})`;
  const span = upper.at - lower.at;
  const ratio = span === 0 ? 0 : (clamped - lower.at) / span;
  // Rounded: a ring redrawn on every SOC tick should not produce a new colour
  // string for a change nobody can see.
  const percent = Math.round(ratio * 100);
  if (percent === 0) return `var(${lower.token})`;
  if (percent === 100) return `var(${upper.token})`;
  // `in oklab`: mixing red to green through sRGB passes through mud.
  return `color-mix(in oklab, var(${upper.token}) ${percent}%, var(${lower.token}))`;
}
