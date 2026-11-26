// The lines the PV forecast sheet's bars stand for (ADR 21 "Details by drilling down"): each
// string of the layout, or each MPPT input they are wired to, named and coloured.
import type { PvString } from "../api/core.ts";
import { mpptColour } from "../energy-colours.ts";
import { indexName } from "../roles.ts";
import type { AheadLine } from "./ahead.ts";
import { partColour } from "./forecast.ts";

/** A forecast line a series of `device` is drawn as. */
export interface Wanted extends Pick<AheadLine, "label" | "colour"> {
  readonly device: number;
  readonly series: string;
}

/** Each string, in its input's colour, lightened per string beside it. */
export function stringLines(strings: readonly Readonly<PvString>[]): Wanted[] {
  return strings.map((s, i) => {
    const series = `pv.string.power[${s.id}]`;
    const beside = strings.slice(0, i).filter((o) => o.device === s.device && o.input === s.input);

    return {
      device: s.device,
      series,
      label: s.name === "" ? (indexName(series) ?? series) : s.name,
      colour: partColour(s.input, beside.length),
    };
  });
}

/** Each MPPT input the strings are wired to. */
export function inputLines(strings: readonly Readonly<PvString>[]): Wanted[] {
  const seen = new Set<string>();

  return strings.flatMap(({ device, input }) => {
    const series = `pv.mppt.power[${input}]`;

    if (seen.has(`${device}/${series}`)) return [];

    seen.add(`${device}/${series}`);

    return [{ device, series, label: indexName(series) ?? series, colour: mpptColour(input) }];
  });
}
