// Where the band chart draws each bar, mark and gridline: plain boxes placed and sized only by
// `transform`, so every change runs on CSS transitions (ADR 21).
import { m } from "../paraglide/messages.js";
import { getLocale } from "../paraglide/runtime.js";
import type { Via } from "./range.ts";

export type { Via } from "./range.ts";

export interface Band {
  readonly key: string;
  readonly label: string;
  readonly tick: boolean;
  readonly title: string;
  readonly state: "data" | "gap" | "live" | "future" | "before";
  readonly partial: boolean;
  readonly up: readonly number[];
  readonly down: readonly number[];
  /** A reference value on the upper side: a forecast or last year's figure. */
  readonly mark?: number | null | undefined;
  /** The upper side's expected height where the band has not happened yet. */
  readonly ghost?: number | null | undefined;
  readonly drillable: boolean;
}

export interface SeriesMeta {
  readonly label: string;
  readonly colour: string;
}

export interface Readout {
  readonly title: string;
  readonly up: readonly number[];
  readonly down: readonly number[];
  readonly mark?: number | null | undefined;
  /** What is still expected, where bands have not happened yet. */
  readonly ghost?: number | null | undefined;
  /** The keys state no value: one series, whose sum the sheet's head already states. */
  readonly bare?: boolean | undefined;
}

const COARSE = [1, 1.5, 2, 3, 4, 5, 6, 8, 10];
const FINE = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];

/** The smallest round number at or above `v`, whose half is round too. */
function niceCeil(v: number, fine = false): number {
  if (v <= 0) return 0;

  const p = 10 ** Math.floor(Math.log10(v));
  const step = (fine ? FINE : COARSE).find((n) => n * p >= v * 1.04);

  return (step ?? 10) * p;
}

const add = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

/** The plot's scale: the upper side's top, the lower side's depth, and where the baseline sits. */
export interface Scale {
  readonly upMax: number;
  readonly downMax: number;
  readonly span: number;
  /** The baseline, in % from the top. */
  readonly zero: number;
}

export function scaleOf(bands: readonly Band[], lower: boolean, max?: number): Scale {
  const tallest = Math.max(0, ...bands.map((b) => Math.max(add(b.up), b.mark ?? 0, b.ghost ?? 0)));

  const upMax = max ?? (niceCeil(tallest) || 1);
  const downMax = lower ? niceCeil(Math.max(0, ...bands.map((b) => add(b.down))), true) : 0;
  const span = upMax + downMax;

  return { upMax, downMax, span, zero: (upMax / span) * 100 };
}

/** A value's place on a scale, in % from the top. */
export const place = (v: number, top: number, whole: number): number => ((top - v) / whole) * 100;

const move = (top: number, size: number) =>
  `translateY(${top.toFixed(3)}%) scaleY(${Math.max(0, size).toFixed(5)})`;

export interface Seg {
  readonly colour: string;
  readonly transform: string;
}

/** A bar's stacked segments, `gap` (a share of the plot) apart. */
function segs(
  b: Band,
  colours: readonly [readonly string[], readonly string[]],
  s: Scale,
  gap: number,
): Seg[] {
  const out: Seg[] = [];
  let c = 0;

  for (const [i, v] of b.up.entries()) {
    out.push({
      colour: colours[0][i]!,
      transform: move(((s.upMax - c - v) / s.span) * 100, v / s.span - (v > 0 ? gap : 0)),
    });
    c += v;
  }

  c = 0;

  for (const [i, v] of b.down.entries()) {
    const top = (((s.upMax + c) / s.span) * 100).toFixed(3);
    const size = Math.max(0, v / s.span - (v > 0 ? gap : 0)).toFixed(5);

    out.push({
      colour: colours[1][i]!,
      transform: `translateY(calc(${top}% + 2px)) scaleY(${size})`,
    });
    c += v;
  }

  return out;
}

/** The bar's box before its transform, and a mark's. */
const BAR = 24;
export const MARK = 32;

export interface View {
  readonly key: string;
  readonly b: Band;
  /** The bar's left edge and its width as a share of `BAR`; the band's centre; its slot's width. */
  readonly x: number;
  readonly sx: number;
  readonly cx: number;
  readonly slot: number;
  readonly sy: number;
  readonly segs: readonly Seg[];
  readonly ghost: string | null;
  /** Where an arriving bar starts. */
  readonly x0: number;
  readonly sx0: number;
  readonly cx0: number;
  readonly sy0: number;
  readonly zoom: boolean;
}

/** Each band's bar in a plot `width` px wide and `height` px high. */
export function viewsOf(
  bands: readonly Band[],
  colours: readonly [readonly string[], readonly string[]],
  s: Scale,
  width: number,
  height: number,
): View[] {
  const slot = bands.length > 0 ? width / bands.length : 0;
  const bw = Math.min(BAR, Math.max(3, slot * 0.62));
  // The 2 px of surface between stacked segments, as a share of the plot.
  const gap = height > 0 ? 2 / height : 0;

  return bands.map((b, i) => {
    const cx = (i + 0.5) * slot;
    const x = cx - bw / 2;
    const ghost = b.ghost ?? 0;

    return {
      key: b.key,
      b,
      x,
      sx: bw / BAR,
      cx,
      slot,
      sy: 1,
      segs: b.state === "gap" ? [] : segs(b, colours, s, gap),
      ghost: ghost > 0 ? move(((s.upMax - ghost) / s.span) * 100, ghost / s.span) : null,
      x0: x,
      sx0: bw / BAR,
      cx0: cx,
      sy0: 0,
      zoom: false,
    };
  });
}

export interface Tick {
  readonly key: string;
  readonly v: number;
  readonly y: number;
  readonly y0: number;
  readonly text: string;
}

/** An axis figure: at most one decimal. */
const axis = (v: number): string =>
  new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 1 }).format(v);

/** The multiples of `step` up to `depth`, from the first. */
const steps = (depth: number, step: number): number[] =>
  Array.from({ length: Math.floor(depth / step + 1e-9) }, (_, i) => (i + 1) * step);

/**
 * Gridlines at the baseline and at each half of the taller side; the other side mirrors that step
 * as far as it reaches, so both read on one scale and no lone figure marks the plot's foot.
 */
export function ticksOf(s: Scale, format: (v: number) => string = axis): Tick[] {
  const step = Math.max(s.upMax, s.downMax) / 2;
  const below = steps(s.downMax, step).map((v) => -v);
  const values = [...steps(s.upMax, step).toReversed(), 0, ...below];

  return values.map((v) => ({
    key: String(v),
    v,
    y: place(v, s.upMax, s.span),
    y0: place(v, s.upMax, s.span),
    text: v === 0 ? "0" : format(Math.abs(v)),
  }));
}

/**
 * A drill or a brush as a FLIP along the time axis: the chosen span is a rect in the outer range's
 * plot, the new bars arrive from it (or spread into it) and the old ones leave to it.
 */
function zoomed(views: readonly View[], zoom: Readonly<Via>, width: number) {
  const f = Math.max(1 / 40, zoom.b - zoom.a);
  const a = zoom.a * width;
  const into = (x: number) => a + x * f;
  const outOf = (x: number) => (x - a) / f;
  const [enter, exit] = zoom.inward ? [into, outOf] : [outOf, into];
  const [es, ls] = zoom.inward ? [f, 1 / f] : [1 / f, f];

  return {
    arrive: views.map((o) =>
      Object.assign({}, o, {
        x0: enter(o.x),
        sx0: o.sx * es,
        cx0: enter(o.cx),
        sy0: 1,
        zoom: true,
      }),
    ),
    leave: (o: View) =>
      Object.assign({}, o, { x: exit(o.x), sx: o.sx * ls, cx: exit(o.cx), zoom: true }),
  };
}

/** What a band being read is, beside its title. */
export function stateText(b: Readonly<Band> | null): string {
  if (!b) return "";

  if (b.state === "gap") return m.range_no_data();

  if (b.state === "future")
    return (b.ghost ?? null) === null ? m.range_future() : m.range_forecast();

  if (b.state === "before") return m.range_before();

  if (b.state === "live") return m.range_running();

  return b.partial ? m.range_partial() : "";
}

const shrink = (o: Readonly<View>): View => Object.assign({}, o, { sy: 0, zoom: false });

/**
 * How the bars get to `views`: keyed by place within generation `gen`, so a morph moves them; a
 * zoom brings a new generation in from the chosen span. A bar with no place left shrinks away.
 */
export function moves(
  views: readonly View[],
  zoom: Readonly<Via> | null,
  width: number,
  gen: number,
) {
  const z = zoom ? zoomed(views, zoom, width) : null;
  const items = (z?.arrive ?? views).map((o) => Object.assign({}, o, { key: `${gen}:${o.key}` }));

  return z ? { items, exit: 300, leave: z.leave } : { items, exit: 150, leave: shrink };
}
