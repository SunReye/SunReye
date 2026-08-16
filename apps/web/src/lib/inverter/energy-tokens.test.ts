/**
 * The semantic colour set: what each token means, that every one is declared on
 * both surfaces, and that the colours which appear TOGETHER on a screen stay
 * far enough apart to tell apart — including for a reader with a colour-vision
 * deficiency.
 *
 * This exists because of a real regression. The power-flow diagram painted its
 * nodes from the CATEGORICAL palette, whose whole contract is "the Nth series,
 * order arbitrary". Re-ordering that palette moved battery to cyan and load to
 * green — side by side on one diagram, indistinguishable — and made the
 * generator and the EV charger literally the same orange. A fixed meaning must
 * never draw from a set whose order is arbitrary, and a palette has to be
 * chosen as a SET: fixing one pair moves it next to another.
 *
 * Sets are scored by their WEAKEST pair, per screen, per theme, under all three
 * dichromacies.
 */

import { describe, expect, test } from "bun:test";

/**
 * ── Fixture: how far apart two palette colours actually are, including for a
 * reader with a colour-vision deficiency.
 *
 * A test fixture and not production code — nothing renders with it; it exists
 * so the palette can be argued for with numbers instead of taste. Kept in this
 * file rather than beside the source for exactly that reason.
 *
 * The semantic set is chosen as a SET, not pair by pair. That is the lesson the
 * overview taught: battery was cyan and load was green because each had been
 * picked against different neighbours, and side by side on one diagram they
 * were the same colour. Worse, fixing one pair moves it next to another — a
 * magenta battery collides with a magenta grid. So every pair is measured, in
 * both themes, under all three deficiencies, and the weakest pair is the score.
 *
 * The maths is deliberately plain and self-contained: sRGB hex in, OKLab out
 * (which is perceptually uniform enough that a Euclidean distance means
 * something), with the Brettel/Viénot-style dichromat projections applied in
 * linear RGB on the way. No dependency, and every step is a pure function the
 * tests can pin.
 */

/** A colour as linear-light RGB, each channel 0..1. */
type Rgb = readonly [number, number, number];

/** The three dichromacies, plus normal vision. */
type Vision = "normal" | "protan" | "deutan" | "tritan";

const VISIONS: readonly Vision[] = ["normal", "protan", "deutan", "tritan"];

/** `#rrggbb` to linear RGB. Throws on anything else — a silent 0 would read as black. */
function parseHex(hex: string): Rgb {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) throw new Error(`not a 6-digit hex colour: ${hex}`);
  const int = Number.parseInt(match[1]!, 16);
  const channels = [(int >> 16) & 0xff, (int >> 8) & 0xff, int & 0xff] as const;
  return channels.map((c) => srgbToLinear(c / 255)) as unknown as Rgb;
}

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/**
 * Linear RGB to OKLab. Distances in this space track perceived difference far
 * better than in sRGB, which is the whole reason for the conversion.
 */
function oklab(rgb: Rgb): readonly [number, number, number] {
  const [r, g, b] = rgb;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/**
 * A dichromat's view of a colour, as a projection in linear RGB.
 *
 * Simplified Viénot/Brettel: enough to answer "would these two still be
 * different?", which is the only question asked of it. It is not a colour
 * management tool and does not claim to be.
 */
function simulate(rgb: Rgb, vision: Vision): Rgb {
  const [r, g, b] = rgb;
  if (vision === "normal") return rgb;
  if (vision === "protan") return [0.1122 * r + 0.8877 * g, 0.1122 * r + 0.8877 * g, b];
  if (vision === "deutan") return [0.2929 * r + 0.7071 * g, 0.2929 * r + 0.7071 * g, b];
  // Tritan: the blue channel collapses onto the green one.
  return [r, 0.5 * g + 0.5 * b, 0.5 * g + 0.5 * b];
}

/** Perceptual distance between two hex colours, as seen with `vision`. */
function separation(a: string, b: string, vision: Vision = "normal"): number {
  const [la, aa, ba] = oklab(simulate(parseHex(a), vision));
  const [lb, ab, bb] = oklab(simulate(parseHex(b), vision));
  return Math.hypot(la - lb, aa - ab, ba - bb);
}

/** One pair's worst showing across every vision. */
interface WeakestPair {
  a: string;
  b: string;
  vision: Vision;
  distance: number;
}

/**
 * The weakest pair in a set — the score that matters, because a palette is only
 * as good as its two most similar members. `null` for a set of fewer than two.
 */
function pairsOf(names: readonly string[]): [string, string][] {
  const out: [string, string][] = [];
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) out.push([names[i]!, names[j]!]);
  }
  return out;
}

function weakestPair(colors: Readonly<Record<string, string>>): WeakestPair | null {
  let worst: WeakestPair | null = null;
  for (const [a, b] of pairsOf(Object.keys(colors))) {
    for (const vision of VISIONS) {
      const distance = separation(colors[a]!, colors[b]!, vision);
      if (!worst || distance < worst.distance) worst = { a, b, vision, distance };
    }
  }
  return worst;
}

const css = await Bun.file(new URL("../../app.css", import.meta.url)).text();

/** Every semantic meaning the app paints. */
const SEMANTIC: string[] = [
  "energy-grid",
  "energy-solar",
  "energy-selfused",
  "energy-export",
  "energy-battery",
  "energy-load",
  "energy-ev",
  "energy-generator",
];

/**
 * The `:root` block and the `.dark` block, split at the rule that opens the
 * dark surface. Anchored on `\n.dark {` rather than the first `.dark` in the
 * file, which is the `@custom-variant` declaration on line 6 — matching that
 * one leaves the light block empty and every case below fails for the wrong
 * reason.
 */
const darkAt = css.indexOf("\n.dark {");
const lightBlock = css.slice(0, darkAt);
const darkBlock = css.slice(darkAt, css.indexOf("@theme"));

function declared(block: string, token: string): string | null {
  return new RegExp(`--${token}:\\s*(#[0-9a-fA-F]{6})\\s*;`).exec(block)?.[1] ?? null;
}

const light = Object.fromEntries(SEMANTIC.map((t) => [t, declared(lightBlock, t)]));
const dark = Object.fromEntries(SEMANTIC.map((t) => [t, declared(darkBlock, t)]));

describe("the semantic set is complete", () => {
  test.each(SEMANTIC)("--%s is declared for the light surface", (token) => {
    expect(light[token], `--${token} missing from :root`).not.toBeNull();
  });

  test.each(SEMANTIC)("--%s is declared for the dark surface", (token) => {
    // Not optional: these are hand-lifted for the dark background, and a token
    // that inherits the light value reads muddy on it.
    expect(dark[token], `--${token} missing from .dark`).not.toBeNull();
  });

  test.each(SEMANTIC)("--%s has a Tailwind mapping", (token) => {
    // Without it `text-energy-load` and friends silently produce nothing —
    // Tailwind only emits what it can see.
    expect(css).toContain(`--color-${token}: var(--${token});`);
  });

  test("the dark value is a lift, not a copy", () => {
    for (const token of SEMANTIC) {
      expect(dark[token], `--${token} repeats its light value on the dark surface`).not.toBe(
        light[token],
      );
    }
  });
});

/**
 * The colours that share one screen. Scored per set, because eight hues that
 * are all mutually distinct under dichromacy do not exist — what matters is
 * that the ones drawn TOGETHER are.
 */
const SCREENS: Record<string, readonly string[]> = {
  // The power-flow diagram: every node the plant can have at once.
  diagram: [
    "energy-solar",
    "energy-battery",
    "energy-grid",
    "energy-load",
    "energy-ev",
    "energy-generator",
  ],
  // The four daily-energy tiles on /overview.
  tiles: ["energy-solar", "energy-load", "energy-export", "energy-grid"],
  // The /system live KPI charts.
  system: ["energy-solar", "energy-battery", "energy-grid", "energy-load"],
  // The statistics energy series.
  statistics: ["energy-solar", "energy-selfused", "energy-export", "energy-grid"],
};

/**
 * The floor: the weakest pair the SHIPPED five-token set already had before
 * anything was added to it (grid vs solar, deutan, on the dark surface). It is
 * a ratchet, not an aspiration — eight-way separation under dichromacy is not
 * achievable, and pretending otherwise would mean a test nobody could satisfy.
 * What it forbids is making the set WORSE, which is exactly what happened when
 * meanings were painted from the categorical palette.
 */
const FLOOR = 0.032;

describe("colours that appear together can be told apart", () => {
  for (const [screen, tokens] of Object.entries(SCREENS)) {
    test(`${screen}, light`, () => {
      const worst = weakestPair(Object.fromEntries(tokens.map((t) => [t, light[t]!])))!;
      expect(
        worst.distance,
        `${worst.a} vs ${worst.b} under ${worst.vision}: ${worst.distance.toFixed(4)}`,
      ).toBeGreaterThanOrEqual(FLOOR);
    });

    test(`${screen}, dark`, () => {
      const worst = weakestPair(Object.fromEntries(tokens.map((t) => [t, dark[t]!])))!;
      expect(
        worst.distance,
        `${worst.a} vs ${worst.b} under ${worst.vision}: ${worst.distance.toFixed(4)}`,
      ).toBeGreaterThanOrEqual(FLOOR);
    });
  }

  test("load is not another green — self-used already owns green", () => {
    // The specific confusion on /overview: the consumption tile read green,
    // which is the colour this app uses for production kept on-site.
    for (const vision of VISIONS) {
      expect(separation(light["energy-load"]!, light["energy-selfused"]!, vision)).toBeGreaterThan(
        FLOOR,
      );
    }
  });

  test("the generator and the EV charger are not the same colour", () => {
    // They were: both spent categorical slot 2, so a plant with both showed two
    // identical orange nodes whose only difference was the glyph.
    expect(separation(light["energy-generator"]!, light["energy-ev"]!)).toBeGreaterThan(FLOOR);
    expect(separation(dark["energy-generator"]!, dark["energy-ev"]!)).toBeGreaterThan(FLOOR);
  });
});

describe("parseHex", () => {
  test("reads a six-digit hex", () => {
    expect(parseHex("#ffffff")).toEqual([1, 1, 1]);
    expect(parseHex("#000000")).toEqual([0, 0, 0]);
  });

  test("is case-insensitive and tolerates surrounding space", () => {
    // The values are read out of app.css, where they sit inside a declaration.
    expect(parseHex(" #C0473B ")).toEqual(parseHex("#c0473b"));
  });

  test("linearises rather than taking the byte", () => {
    // Mid grey is 0.216 in linear light, not 0.5. Distances computed on raw
    // bytes would overstate how different two dark colours are.
    const [r] = parseHex("#808080");
    expect(r).toBeGreaterThan(0.2);
    expect(r).toBeLessThan(0.23);
  });

  test("refuses anything that is not a six-digit hex", () => {
    // A silent zero would read as black and make every comparison against it
    // look healthy.
    for (const bad of ["#fff", "red", "var(--energy-grid)", "#12345g", ""]) {
      expect(() => parseHex(bad)).toThrow();
    }
  });
});

describe("oklab", () => {
  test("puts white and black at the ends of the lightness axis", () => {
    expect(oklab(parseHex("#ffffff"))[0]).toBeCloseTo(1, 2);
    expect(oklab(parseHex("#000000"))[0]).toBeCloseTo(0, 2);
  });

  test("gives grey no chroma", () => {
    const [, a, b] = oklab(parseHex("#808080"));
    expect(Math.hypot(a, b)).toBeLessThan(0.001);
  });
});

describe("simulate", () => {
  test("leaves a colour alone for normal vision", () => {
    const rgb = parseHex("#c0473b");
    expect(simulate(rgb, "normal")).toEqual(rgb);
  });

  test("collapses red against green for protan and deutan", () => {
    // The whole point: two colours that differ only along the red-green axis
    // must come out nearly identical, which is what makes the floor mean
    // something.
    expect(separation("#c0473b", "#2f9e63", "deutan")).toBeLessThan(
      separation("#c0473b", "#2f9e63", "normal"),
    );
  });

  test("collapses blue for tritan", () => {
    expect(separation("#4478c4", "#2f9e63", "tritan")).toBeLessThan(
      separation("#4478c4", "#2f9e63", "normal"),
    );
  });
});

describe("separation", () => {
  test("is zero for a colour against itself, under every vision", () => {
    for (const vision of VISIONS) expect(separation("#c0473b", "#c0473b", vision)).toBe(0);
  });

  test("is symmetric", () => {
    expect(separation("#c0473b", "#4478c4")).toBeCloseTo(separation("#4478c4", "#c0473b"), 12);
  });

  test("puts black and white furthest apart", () => {
    expect(separation("#000000", "#ffffff")).toBeGreaterThan(separation("#c0473b", "#4478c4"));
  });
});

describe("weakestPair", () => {
  test("finds the two closest members and the vision that closes them", () => {
    const worst = weakestPair({ red: "#c0473b", green: "#2f9e63", white: "#ffffff" });
    expect([worst!.a, worst!.b].sort()).toEqual(["green", "red"]);
    expect(worst!.vision).not.toBe("normal");
  });

  test("is null for a set too small to have a pair", () => {
    expect(weakestPair({})).toBe(null);
    expect(weakestPair({ only: "#c0473b" })).toBe(null);
  });

  test("scores a set by its worst pair, not its average", () => {
    // A palette is exactly as good as its two most similar members; averaging
    // would let one indistinguishable pair hide behind six good ones.
    const withClash = weakestPair({
      a: "#c0473b",
      b: "#4478c4",
      c: "#2f9e63",
      d: "#2f9e64",
    });
    expect(withClash!.distance).toBeLessThan(0.01);
  });
});
