/**
 * The decisions behind `<AnimatedNumber>`: how many decimals a reading gets and
 * how it is formatted. The rune shell next door keeps only the Tween plumbing
 * and the markup (runes do not run under `bun test` — apps/web/TESTING.md); how
 * long a glide lasts is `_shared/glide.ts`, shared with the charts' cursor so
 * the two cannot drift apart.
 *
 * Why it is shaped this way: the readouts tween continuously by design, so the
 * display expression recomputes on every animation frame, for every mounted
 * instance, forever. Profiling the /history page found the old
 * `tween.current.toLocaleString(undefined, opts)` to be the largest single JS
 * self-time entry on the page — `toLocaleString` builds a fresh
 * `Intl.NumberFormat` on every call (resolving the locale, canonicalising the
 * options bag, allocating an ICU formatter) and throws it away again. Two
 * cheap moves remove essentially all of it: share one formatter per
 * (locale, decimals), and skip formatting entirely on the frames where the
 * ROUNDED value has not moved — which for `W` and `%` (0 decimals) is most of
 * them.
 */

import { configuredDecimals } from "$lib/inverter/format";

/** What a missing or non-finite reading renders as — same as `formatValue()`. */
const EMPTY = "—";

/** Intl accepts 0..20 fraction digits and throws outside that range. */
const MAX_FRACTION_DIGITS = 20;

const FORMATTERS = new Map<string, Intl.NumberFormat>();

/**
 * A shared `Intl.NumberFormat` for this (locale, decimals). Formatters are
 * expensive to construct and stateless once built, so every readout on the page
 * uses the same one instead of allocating its own per frame.
 *
 * `locale` is `undefined` today (the system locale). It is a parameter so that a
 * user-selected locale can be keyed into the cache rather than silently served a
 * stale formatter — if that setting ever arrives, every caller must pass it.
 */
// fallow-ignore-next-line unused-export -- the shared cache IS the fix (a fresh ICU formatter per frame was the page's largest JS self-time entry) and formatter IDENTITY is what proves it; that is unobservable through createNumberDisplay, so the boundary is pinned on the export
export function formatterFor(decimals: number, locale?: string): Intl.NumberFormat {
  const places = Math.min(Math.max(Math.trunc(decimals) || 0, 0), MAX_FRACTION_DIGITS);
  const key = `${locale ?? ""}|${places}`;
  let formatter = FORMATTERS.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, {
      minimumFractionDigits: places,
      maximumFractionDigits: places,
    });
    FORMATTERS.set(key, formatter);
  }
  return formatter;
}

/**
 * Decimal places for a reading, locked to a single count (min = max) so the
 * digit shape stays fixed mid-tween — otherwise an intermediate frame could
 * sprout an extra decimal and make the text jump.
 *
 * A unit with a configured precision (e.g. `W` → 0) wins; otherwise fall back to
 * the *target* value's own places, floored at 1 (so `2` reads `2.0`) and capped
 * at 2. Values with no dot in their `String()` form — integers, but also `1e-7`
 * and `1e21` — take the floor, which is what keeps the result inside Intl's
 * legal range for every input including `undefined` and `NaN`.
 */
export function resolveDecimals(
  unit: string | null | undefined,
  target: number | undefined,
): number {
  const fixed = configuredDecimals(unit);
  if (fixed !== undefined) return fixed;
  if (target === undefined || Number.isInteger(target)) return 1;
  const text = String(target);
  const dot = text.indexOf(".");
  const places = dot === -1 ? 0 : text.length - dot - 1;
  return Math.min(Math.max(places, 1), 2);
}

/**
 * Rounds half AWAY FROM ZERO, which is what Intl's default `halfExpand` mode
 * does and what `Math.round` does NOT: `Math.round(-2.5)` is `-2` while Intl
 * renders `-3`. Getting that wrong would poison a whole bucket — a value that
 * should read `-2` would be served the cached `-3` for as long as it stayed
 * there. Do not "simplify" this back to `Math.round`.
 *
 * `-0` is normalised to `0` so a value drifting up through zero cannot thrash
 * the memo key (and, as a side effect, `-0` renders without its sign).
 *
 * Module-private: it is the memo key, not a value anyone outside computes. Its
 * rounding is pinned through {@link createNumberDisplay}, whose injected
 * `format` receives the quantised value.
 */
function quantize(value: number, decimals: number): number {
  const scale = 10 ** decimals;
  const q = Math.sign(value) * Math.round(Math.abs(value) * scale);
  return q === 0 ? 0 : q;
}

export interface NumberDisplay {
  /**
   * The text for this frame — the SAME string instance for as long as the
   * rounded value is unchanged, so Svelte's derived equality check stops the
   * update dead and no `nodeValue` write reaches the DOM.
   */
  format(value: number | undefined, decimals: number): string;
}

function defaultFormat(value: number, decimals: number): string {
  return formatterFor(decimals).format(value);
}

/**
 * A per-readout memo over the formatted text. The string is a pure function of
 * (rounded value, decimals), so it only has to be produced when that pair
 * changes. State is per instance — created once at component init — so two
 * readouts showing different values cannot contaminate each other; only the
 * formatter cache is module-global, which is safe because formatters are
 * stateless.
 *
 * `format` is injectable purely as a testing seam (proving no formatting
 * happens on an unchanged bucket without reaching for `mock.module`).
 */
export function createNumberDisplay(
  format: (value: number, decimals: number) => string = defaultFormat,
): NumberDisplay {
  let lastQuantized: number | undefined;
  let lastDecimals: number | undefined;
  let lastText = EMPTY;
  return {
    format(value, decimals) {
      if (value === undefined || !Number.isFinite(value)) {
        lastQuantized = undefined;
        lastDecimals = undefined;
        lastText = EMPTY;
        return lastText;
      }
      const q = quantize(value, decimals);
      if (q === lastQuantized && decimals === lastDecimals) return lastText;
      lastQuantized = q;
      lastDecimals = decimals;
      // Format from the QUANTIZED value, not the raw frame, so the text is a
      // genuine function of the memo key rather than of whichever frame
      // happened to land in the bucket first.
      lastText = format(q / 10 ** decimals, decimals);
      return lastText;
    },
  };
}
