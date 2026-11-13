// What the solar forecast screen shows (ADR 17): each inverter's total, each MPPT input and its
// strings, with estimated strings marked.
import type { Core, Forecasts, PvString } from "../api/core.ts";
import { flowColour } from "../energy-colours.ts";
import { m } from "../paraglide/messages.js";
import { intervals, spread, type Span } from "../range/fill.ts";

/** The measured production's bars, in the solar flow. */
export function measuredBar() {
  return { label: m.forecast_measured(), colour: flowColour("solar") };
}

/** One forecast series and its legend label. */
export interface Line {
  readonly series: string;
  readonly label: string;
}

/** An inverter's forecast lines: its total, then each MPPT input followed by its strings. */
export interface InverterLines {
  readonly device: number;
  readonly lines: readonly Line[];
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
  const lines: Line[] = [{ series: "pv.power", label: m.forecast_total() }];

  for (const input of sorted(strings.map((s) => s.input))) {
    lines.push({ series: `pv.mppt.power[${input}]`, label: m.forecast_input({ input }) });

    for (const s of strings.filter((wired) => wired.input === input)) {
      const series = `pv.string.power[${s.id}]`;

      const label = estimated.includes(series)
        ? m.forecast_string_estimated({ name: s.name })
        : s.name;

      lines.push({ series, label });
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

/** A line's latest forecasts from `from` to before `to`. */
export async function planned(
  core: Readonly<Pick<Core, "forecasts">>,
  device: number,
  series: string,
  from: Readonly<Date>,
  to: Readonly<Date>,
): Promise<Planned[]> {
  const forecasts = await core.forecasts(device, series, new Date(from), new Date(to));

  const points: readonly Readonly<Forecasts["points"][number]>[] =
    "points" in forecasts ? forecasts.points : [];

  return intervals(points, (p) => Date.parse(p.target)).map(({ start, end, item }) => ({
    start,
    end,
    power: item.value,
  }));
}

/** The energy a forecast expects in [from, to), in kWh. */
export function plannedEnergy(items: readonly Planned[], from: number, to: number): number {
  return spread(items, from, to, (p) => (p.power * (p.end - p.start)) / 3_600_000_000).sum;
}
