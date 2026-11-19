// What the solar forecast screen shows (ADR 17): each inverter's total, each MPPT input and its
// strings, with estimated strings marked.
import type { Core, PvString } from "../api/core.ts";
import { flowColour, mpptColour } from "../energy-colours.ts";
import { m } from "../paraglide/messages.js";
import { intervals, spread, type Span } from "../range/fill.ts";

/** The measured production's bars, in the solar flow. */
function measuredBar() {
  return { label: m.forecast_measured(), colour: flowColour("solar") };
}

/** One stacked part: a series measured, less the parts stacked beside it from the same input. */
export interface Part {
  readonly series: string;
  readonly minus: readonly string[];
  /** Shown only while it holds energy: what an input measured before its strings were laid out. */
  readonly optional: boolean;
}

interface Stacked {
  readonly part: Part;
  readonly label: string;
  readonly input: number;
}

/**
 * One input's parts: the input whole, or each of its parallel strings (estimated) plus what the
 * input measured that its strings do not hold, such as before they were laid out.
 */
function inputParts(input: Readonly<Line>, lines: readonly Readonly<Line>[]): Stacked[] {
  const at = input.input ?? 1;
  const strings = lines.filter((l) => l.kind === "string" && l.input === input.input);

  if (strings.length < 2)
    return [
      { part: { series: input.series, minus: [], optional: false }, label: input.label, input: at },
    ];

  const split = strings.map((l) => ({
    part: { series: l.series, minus: [], optional: false },
    label: l.estimated ? `${l.label} ≈` : l.label,
    input: at,
  }));

  const rest = {
    part: { series: input.series, minus: strings.map((l) => l.series), optional: true },
    label: m.forecast_unsplit({ input: input.label }),
    input: at,
  };

  return [...split, rest];
}

/** The colour of the `nth` part on MPPT input `input`: the input's colour, lightened per string. */
export function partColour(input: number, nth: number): string {
  const base = mpptColour(input);

  return nth === 0 ? base : `color-mix(in oklab, ${base} ${100 - nth * 30}%, white)`;
}

/**
 * What `line`'s bars stack: an inverter's total with two or more parts stacks them, an MPPT input
 * shared by parallel strings split into its (estimated) strings; anything else is one measured bar.
 */
export function stackOf(line: Readonly<Line>, lines: readonly Readonly<Line>[]) {
  const stacked =
    line.kind === "total"
      ? lines.filter((l) => l.kind === "input").flatMap((input) => inputParts(input, lines))
      : [];

  if (stacked.filter((s) => !s.part.optional).length < 2)
    return { parts: [], up: [{ ...measuredBar(), optional: false }] };

  return {
    parts: stacked.map((s) => s.part),
    up: stacked.map((s, i) => ({
      label: s.label,
      colour: partColour(s.input, stacked.slice(0, i).filter((p) => p.input === s.input).length),
      optional: s.part.optional,
    })),
  };
}

/** One forecast series: the inverter's total, an MPPT input or a string on one. */
export interface Line {
  readonly series: string;
  readonly label: string;
  /** The MPPT input a string or an input line is on. */
  readonly input: number | null;
  readonly kind: "total" | "input" | "string";
  /** Measured together with its parallel strings and split by the model (ADR 17). */
  readonly estimated: boolean;
}

/** An inverter's forecast lines: its total, then each MPPT input followed by its strings. */
export interface InverterLines {
  readonly device: number;
  readonly lines: readonly Line[];
}

/** A line as its picker shows it: a string under its input. */
export function lineName(line: Readonly<Line>): string {
  const mark = line.estimated ? " ≈" : "";

  return line.kind === "string"
    ? `${m.forecast_input({ input: line.input ?? 0 })} · ${line.label}${mark}`
    : line.label;
}

/** Two days past today, as far as the solar forecast reaches (ADR 17). */
export const AHEAD = 2;

function sorted(numbers: readonly number[]): number[] {
  return [...new Set(numbers)].toSorted((a, b) => a - b);
}

/** One inverter's lines; its series in `estimated` are marked. */
function linesOf(
  device: number,
  strings: readonly Readonly<PvString>[],
  estimated: readonly string[],
): InverterLines {
  const lines: Line[] = [
    { series: "pv.power", label: m.forecast_total(), input: null, kind: "total", estimated: false },
  ];

  for (const input of sorted(strings.map((s) => s.input))) {
    lines.push({
      series: `pv.mppt.power[${input}]`,
      label: m.forecast_input({ input }),
      input,
      kind: "input",
      estimated: false,
    });

    for (const s of strings.filter((wired) => wired.input === input)) {
      const series = `pv.string.power[${s.id}]`;

      lines.push({
        series,
        label: s.name,
        input,
        kind: "string",
        estimated: estimated.includes(series),
      });
    }
  }

  return { device, lines };
}

/** The lines of each inverter the layout in force wires strings to; none without a layout. */
export async function inverterLines(
  core: Readonly<Pick<Core, "layout" | "capabilities">>,
): Promise<InverterLines[]> {
  const [layout, capabilities] = await Promise.all([core.layout(), core.capabilities()]);

  if (!("strings" in layout && "devices" in capabilities)) return [];

  const strings: readonly Readonly<PvString>[] = layout.strings;

  return sorted(strings.map((s) => s.device)).map((device) =>
    linesOf(
      device,
      strings.filter((s) => s.device === device),
      capabilities.devices[String(device)]?.estimated ?? [],
    ),
  );
}

/** One forecast's power, held from its target to the next. */
export interface Planned extends Span {
  readonly power: number;
}

/** Forecast targets as powers, each held from its target to the next. */
export function held(points: readonly Readonly<{ target: string; value: number }>[]): Planned[] {
  return intervals(points, (p) => Date.parse(p.target)).map(({ start, end, item }) => ({
    start,
    end,
    power: item.value,
  }));
}

/** The longest forecast read the core serves (ADR 9): 1,500 quarter-hour targets, less a margin. */
const PIECE = 1400 * 900_000;

/**
 * A series' latest forecast targets from `from` to before `to`, read in pieces the core serves;
 * none when any piece is refused.
 */
export async function forecastTargets(
  core: Readonly<Pick<Core, "forecasts">>,
  device: number,
  series: string,
  from: Readonly<Date>,
  to: Readonly<Date>,
): Promise<{ target: string; value: number }[]> {
  const starts: number[] = [];

  for (let a = from.getTime(); a < to.getTime(); a += PIECE) starts.push(a);

  const reads = await Promise.all(
    starts.map((a) =>
      core.forecasts(device, series, new Date(a), new Date(Math.min(to.getTime(), a + PIECE))),
    ),
  );

  const points: { target: string; value: number }[] = [];

  // A held target would bridge a refused piece's hole with one stale value.
  for (const read of reads) {
    if (!("points" in read)) return [];

    points.push(...read.points);
  }

  return points;
}

/** A line's latest forecasts from `from` to before `to`. */
export async function planned(
  core: Readonly<Pick<Core, "forecasts">>,
  device: number,
  series: string,
  from: Readonly<Date>,
  to: Readonly<Date>,
): Promise<Planned[]> {
  return held(await forecastTargets(core, device, series, from, to));
}

/** The energy a forecast expects in [from, to), in kWh. */
export function plannedEnergy(items: readonly Planned[], from: number, to: number): number {
  return spread(items, from, to, (p) => (p.power * (p.end - p.start)) / 3_600_000_000).sum;
}

/** The kWh a forecast expects in [a, b): up to `now`, over all of it, and from `now` on. */
export function forecastIn(items: readonly Planned[], a: number, b: number, now: number) {
  return {
    sofar: plannedEnergy(items, a, Math.min(b, now)),
    whole: plannedEnergy(items, a, b),
    rest: b > now ? plannedEnergy(items, Math.max(a, now), b) : 0,
  };
}
