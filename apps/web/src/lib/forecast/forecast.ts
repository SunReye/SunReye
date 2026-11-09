// What the solar forecast screen shows (ADR 17): each inverter's total, each MPPT input and its
// strings, with estimated strings marked.
import type { Core, Forecasts, PvString } from "../api/core.ts";
import { m } from "../paraglide/messages.js";

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

/** One forecast point of a line. */
export interface Row {
  readonly time: Date;
  readonly power: number;
  /** The line's label. */
  readonly series: string;
}

/** Today and two more days, as the solar forecast covers (ADR 17). */
const DAYS = 3;

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

/** Each line's latest forecast from today's local midnight for three days. */
export async function forecastRows(
  core: Readonly<Pick<Core, "forecasts">>,
  device: number,
  lines: readonly Line[],
): Promise<Row[]> {
  const start = new Date();

  start.setHours(0, 0, 0, 0);

  const end = new Date(start);

  end.setDate(end.getDate() + DAYS);

  const loaded = await Promise.all(
    lines.map(async (line) => {
      const forecasts = await core.forecasts(device, line.series, start, end);

      const points: readonly Readonly<Forecasts["points"][number]>[] =
        "points" in forecasts ? forecasts.points : [];

      return points.map((p) => ({ time: new Date(p.target), power: p.value, series: line.label }));
    }),
  );

  return loaded.flat();
}
