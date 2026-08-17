/**
 * The decisions behind <AnimatedNumber>, lifted out of the rune shell so they
 * can be exercised (runes do not run under `bun test` — apps/web/TESTING.md).
 *
 * Why this module exists at all: profiling the /history page found
 * `tween.current.toLocaleString(...)` as the single largest JS self-time entry
 * (549 ms of a 22.5 s trace). `Number.prototype.toLocaleString` builds a fresh
 * Intl.NumberFormat on EVERY call, and the tween deliberately overshoots the
 * sample cadence so it never settles — so every mounted readout paid an ICU
 * formatter construction 60×/s forever, and wrote a text node with it, even
 * though for `W` and `%` (0 decimals) the string is usually byte-identical.
 */

import { describe, expect, it, mock } from "bun:test";
import { createNumberDisplay, formatterFor, resolveDecimals } from "./animated-number";

/** Exactly what the component used to compute, per frame, for every value. */
const legacy = (v: number, decimals: number) =>
  v.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

/**
 * The memo key the display rounded a frame onto.
 *
 * The rounding is module-private — it is the memo key, not a value any caller
 * computes — so it is read back through the injected `format`, which receives
 * the QUANTISED value rather than the raw frame. That indirection is the point:
 * it also proves the text is a function of the key.
 */
function bucketOf(value: number, decimals: number): number {
  let seen: number | undefined;
  createNumberDisplay((v) => {
    seen = v;
    return "";
  }).format(value, decimals);
  return (seen as number) * 10 ** decimals;
}

describe("formatterFor", () => {
  it("hands back the SAME formatter for a repeated (locale, decimals) — that reuse is the whole point", () => {
    expect(formatterFor(2)).toBe(formatterFor(2));
    expect(formatterFor(0, "de-DE")).toBe(formatterFor(0, "de-DE"));
  });

  it("keys the cache, so a different precision is not served the wrong formatter", () => {
    expect(formatterFor(2)).not.toBe(formatterFor(0));
    expect(formatterFor(0, "de-DE")).not.toBe(formatterFor(0, "en-US"));
    expect(formatterFor(0, "de-DE").format(1234)).toBe("1.234");
    expect(formatterFor(0, "en-US").format(1234)).toBe("1,234");
  });

  it("clamps out-of-range precision instead of letting Intl throw", () => {
    // Intl.NumberFormat accepts 0..20 fraction digits and throws outside it. A
    // readout must never be able to take the page down over a stray decimals.
    expect(formatterFor(-1).resolvedOptions().maximumFractionDigits).toBe(0);
    expect(formatterFor(25).resolvedOptions().maximumFractionDigits).toBe(20);
    expect(formatterFor(Number.NaN).resolvedOptions().maximumFractionDigits).toBe(0);
    expect(formatterFor(1.7).resolvedOptions().maximumFractionDigits).toBe(1);
    expect(formatterFor(-1).format(1234.5)).toBe(legacy(1234.5, 0));
  });
});

describe("resolveDecimals", () => {
  it("lets a unit's configured precision win, even over a fractional value", () => {
    // W and % are whole-number units — fractional watts are noise at inverter scale.
    expect(resolveDecimals("W", 1234.56)).toBe(0);
    expect(resolveDecimals("%", 87.4)).toBe(0);
  });

  it("falls back to the target's own places for an unconfigured unit", () => {
    expect(resolveDecimals("kWh", 1.5)).toBe(1);
    expect(resolveDecimals("kWh", 1.25)).toBe(2);
    expect(resolveDecimals("V", 1.23456)).toBe(2); // capped at 2
    expect(resolveDecimals(null, 2)).toBe(1); // `2` must read `2.0`
    expect(resolveDecimals("", 2)).toBe(1); // falsy unit → no configured entry
  });

  it("stays inside Intl's legal 0..20 for every boundary value", () => {
    // String(1e-7) is "1e-7" and String(1e21) is "1e+21" — neither has a dot, so
    // the places count is 0 and the floor of 1 is what saves it. Keep it that way.
    for (const v of [0, -0.5, undefined, Number.NaN, Infinity, -Infinity, 1e-7, 1e21]) {
      expect(resolveDecimals(null, v)).toBe(1);
    }
    for (const v of [0, 1234.56789, Number.NaN, undefined]) {
      const d = resolveDecimals("kWh", v);
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(20);
    }
  });
});

describe("the memo key a frame rounds onto", () => {
  it("rounds half AWAY FROM ZERO, matching Intl — Math.round would not", () => {
    // This case exists because Math.round(-2.5) is -2 while Intl renders "-3".
    // A signed mismatch would poison a whole bucket: a value that should read
    // "-2" would be served the cached "-3" for as long as it stayed in it.
    expect(bucketOf(2.5, 0)).toBe(3);
    expect(bucketOf(-2.5, 0)).toBe(-3);
    expect(Math.round(-2.5)).toBe(-2); // the trap, pinned
    expect(bucketOf(1.005, 2)).toBe(100); // 1.005 is really 1.00499… as a double
    // …and the rendered text agrees with the key, which is the reason it matters.
    expect(createNumberDisplay().format(-2.5, 0)).toBe(legacy(-3, 0));
  });

  it("normalises -0 so a value drifting up through zero cannot thrash the key", () => {
    expect(bucketOf(-0.4, 0)).toBe(0);
    expect(Object.is(bucketOf(-0.4, 0), -0)).toBe(false);
    expect(Object.is(bucketOf(-0, 0), -0)).toBe(false);
  });
});

describe("createNumberDisplay", () => {
  it("matches the old toLocaleString expression across the value range", () => {
    // The regression net for the whole refactor. The one deliberate divergence
    // is negative zero: the old path could render "-0" for a value drifting up
    // through zero; quantizing normalises the sign away.
    const display = createNumberDisplay();
    const values = [0, 1234.5, -1234.5, 0.005, -0.005, 2.5, -2.5, 1e-7, 999999.999, -7.5];
    for (const v of values) {
      for (const d of [0, 1, 2]) {
        const expected = legacy(v, d).replace(/^-(0(?:[.,]0+)?)$/, "$1");
        expect(`${v}@${d} → ${createNumberDisplay().format(v, d)}`).toBe(`${v}@${d} → ${expected}`);
        display.format(v, d); // same instance, walked through the whole table
      }
    }
  });

  it("renders a signless zero for -0 and for a value rounding to it", () => {
    expect(createNumberDisplay().format(-0, 0)).toBe("0");
    expect(createNumberDisplay().format(-0.4, 0)).toBe("0");
    expect(createNumberDisplay().format(0, 2)).toBe(legacy(0, 2));
  });

  it("formats ONCE while the rounded value stays in its bucket", () => {
    const spy = mock((v: number, d: number) => legacy(v, d));
    const display = createNumberDisplay(spy);
    const first = display.format(1200.1, 0);
    expect(first).toBe("1,200");
    for (const v of [1200.2, 1200.49, 1199.5001, 1200]) {
      // Identity, not just equality: returning the SAME string instance is what
      // makes Svelte's derived equality suppress the nodeValue write.
      expect(display.format(v, 0)).toBe(first);
    }
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("re-formats when the rounded value crosses a bucket", () => {
    const spy = mock((v: number, d: number) => legacy(v, d));
    const display = createNumberDisplay(spy);
    expect(display.format(1200.4, 0)).toBe("1,200");
    expect(display.format(1200.6, 0)).toBe("1,201");
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("re-formats when the decimals change under an unchanged value", () => {
    const spy = mock((v: number, d: number) => legacy(v, d));
    const display = createNumberDisplay(spy);
    expect(display.format(2, 0)).toBe("2");
    expect(display.format(2, 2)).toBe("2.00");
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("shows the em dash for absent and non-finite values, and never formats them", () => {
    const spy = mock((v: number, d: number) => legacy(v, d));
    const display = createNumberDisplay(spy);
    for (const v of [undefined, Number.NaN, Infinity, -Infinity]) {
      expect(display.format(v, 0)).toBe("—");
    }
    expect(spy).toHaveBeenCalledTimes(0);
    // …and the memo must be invalidated by the gap, not left holding a bucket.
    expect(display.format(0, 0)).toBe("0");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("re-formats after returning to a bucket it left", () => {
    const spy = mock((v: number, d: number) => legacy(v, d));
    const display = createNumberDisplay(spy);
    display.format(5, 0);
    display.format(6, 0);
    expect(display.format(5, 0)).toBe("5");
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it("tracks a glide that reverses mid-flight without repeating or skipping a bucket", () => {
    const spy = mock((v: number, d: number) => legacy(v, d));
    const display = createNumberDisplay(spy);
    const frames = [1198, 1198.4, 1199, 1199.6, 1200.2, 1199.9, 1199.1, 1198.2];
    const emitted = frames.map((v) => display.format(v, 0));
    expect(emitted).toEqual([
      "1,198",
      "1,198",
      "1,199",
      "1,200",
      "1,200",
      "1,200",
      "1,199",
      "1,198",
    ]);
    // One format per bucket entered: 1198, 1199, 1200, 1199, 1198.
    expect(spy).toHaveBeenCalledTimes(5);
  });

  it("keeps two instances independent — the memo is per-readout, not module-global", () => {
    const a = createNumberDisplay();
    const b = createNumberDisplay();
    expect(a.format(1, 0)).toBe("1");
    expect(b.format(2, 0)).toBe("2");
    expect(a.format(1, 0)).toBe("1");
  });
});

// The glide DURATION used to live here too, in a second copy of the floor and
// the overshoot that the charts' cursor also carried. It moved to
// `_shared/glide.ts`, the one home both call sites import; `glide.test.ts`
// covers it.

const code = await Bun.file(new URL("./animated-number.svelte", import.meta.url)).text();

describe("animated-number.svelte", () => {
  const OPEN = new Set(["(", "[", "{"]);
  const CLOSE = new Set([")", "]", "}"]);

  /** The text between the balanced parens of the first `name(` call. */
  function callArguments(src: string, name: string): string {
    const at = src.indexOf(`${name}(`);
    if (at === -1) throw new Error(`no call to ${name}`);
    const open = at + name.length;
    let depth = 0;
    for (let i = open; i < src.length; i++) {
      depth += Number(OPEN.has(src[i]!)) - Number(CLOSE.has(src[i]!));
      if (depth === 0) return src.slice(open + 1, i);
    }
    throw new Error(`unbalanced call to ${name}`);
  }

  /** An object-literal property's whole value, to the comma that is not nested. */
  function optionValue(src: string, key: string): string {
    const at = src.indexOf(`${key}:`);
    if (at === -1) throw new Error(`no ${key} option`);
    let depth = 0;
    let out = "";
    for (const ch of src.slice(at + key.length + 1)) {
      depth += Number(OPEN.has(ch)) - Number(CLOSE.has(ch));
      if (depth < 0 || (ch === "," && depth === 0)) break;
      out += ch;
    }
    return out.trim();
  }

  it("does no Intl work of its own — every format goes through the cached formatter", () => {
    expect(code).not.toContain("toLocaleString");
    expect(code).not.toContain("Intl.NumberFormat");
  });

  it("spends glideDurationMs — with the reduced-motion preference — as the tween duration", () => {
    // Pin the two load-bearing tokens INSIDE the duration option: a bare
    // file-level `toContain` stays green while the component computes the
    // duration and then ignores it. Renaming the local cadence variable, or
    // reformatting the call, is not a regression and must not fail here.
    const duration = optionValue(callArguments(code, "tween.set"), "duration");
    expect(duration).toContain("glideDurationMs(");
    expect(duration).toContain("prefersReducedMotion.current");
  });

  it("renders the memoised readout, not the raw tween value", () => {
    const memo = /const\s+(\w+)\s*=\s*\$derived\(\s*readout\.format\(tween\.current/.exec(
      code,
    )?.[1];
    expect(memo).toBeDefined();
    expect(code).toContain(`>{${memo}}<`);
  });
});
